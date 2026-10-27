import { Injectable, Logger } from '@nestjs/common';
import {
  BOT_LIMITS,
  type BotConversationTopic,
  isOperatorHours,
  type Locale,
  matchesComplaint,
} from '@forest/contracts';
import type { Conversation, Prisma } from '@forest/db';
import { randomBytes } from 'node:crypto';
import { imageMeta } from '../admin/files/image-meta';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { BotAlertsService } from './bot-alerts.service';
import { copy, html } from './bot-copy';
import { BotService } from './bot.service';
import { TelegramGateway } from './telegram-gateway.service';

export interface CustomerMessageInput {
  chatId: bigint;
  customerId: string | null;
  topic: BotConversationTopic;
  text: string | null;
  /** Telegram file id of the largest photo size. */
  photoFileId?: string | null;
  firstName: string;
  locale: Locale;
}

/**
 * Operator inbox, customer side (docs/09 flow 4, CLAUDE.md §6 5A): one open conversation per
 * chat; photos go to the private bucket; the advice auto-reply and complaint detection.
 */
@Injectable()
export class BotInboxService {
  private readonly logger = new Logger('BotInbox');

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly gateway: TelegramGateway,
    private readonly bot: BotService,
    private readonly alerts: BotAlertsService,
    private readonly settings: SettingsService,
    private readonly redis: RedisService,
  ) {}

  /** The chat's open conversation (NEW/OPEN/ANSWERED/COMPLAINT), else null. */
  async open(chatId: bigint): Promise<Conversation | null> {
    return this.prisma.conversation.findFirst({
      where: { telegramChatId: chatId, status: { not: 'CLOSED' } },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  /**
   * Appends a customer message. Returns whether it opened/reopened the conversation (auto-reply
   * moment) and whether it is a complaint.
   */
  async customerMessage(
    input: CustomerMessageInput,
    now = new Date(),
  ): Promise<{ conversation: Conversation; opened: boolean; complaint: boolean } | null> {
    const rules = await this.settings.get('bot.rules');
    const complaint = !!input.text && matchesComplaint(input.text, rules.complaintKeywords);
    const existing = await this.open(input.chatId);
    const opened = !existing || existing.status === 'ANSWERED';
    const conversation =
      existing ??
      (await this.prisma.conversation.create({
        data: {
          telegramChatId: input.chatId,
          customerId: input.customerId,
          topic: input.topic,
          status: 'NEW',
          lastMessageAt: now,
        },
      }));
    const fileIds: string[] = [];
    if (input.photoFileId) {
      const fileId = await this.storePhoto(input.photoFileId, `bot/${conversation.id}`);
      if (fileId) fileIds.push(fileId);
      else
        await this.bot
          .send(input.chatId, { text: html(copy(input.locale, 'photoFailed')) })
          .catch(() => undefined);
    }
    const text = input.text?.slice(0, 4000) ?? null;
    if (!text && !fileIds.length) return null;
    const status =
      complaint || existing?.status === 'COMPLAINT'
        ? 'COMPLAINT'
        : existing?.status === 'OPEN'
          ? 'OPEN'
          : 'NEW';
    const [, updated] = await this.prisma.$transaction([
      this.prisma.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          fromCustomer: true,
          text,
          fileIds,
          createdAt: now,
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          status,
          lastMessageAt: now,
          ...(conversation.customerId ? {} : { customerId: input.customerId }),
        },
      }),
    ]);
    if (complaint && existing?.status !== 'COMPLAINT')
      this.alerts.complaint(updated.id, text ?? '[foto]');
    return { conversation: updated, opened, complaint };
  }

  /**
   * "Rasm qabul qilindi…" (operator hours) or the off-hours text, when the message opened the
   * conversation and no auto-reply went to this chat in the last 30 minutes.
   */
  async autoReply(
    chatId: bigint,
    customerId: string | null,
    vars: { ism: string },
    locale: Locale,
    now = new Date(),
  ): Promise<void> {
    const rules = await this.settings.get('bot.rules');
    if (!rules.scenarios.advice) return;
    const fresh = await this.redis.set(
      `tg:autoreply:${chatId}`,
      '1',
      'EX',
      BOT_LIMITS.autoReplyMinutes * 60,
      'NX',
    );
    if (fresh !== 'OK') return;
    const hours = await this.settings.get('messaging.rules');
    const key = isOperatorHours(hours, now) ? 'advice_received' : 'advice_off_hours';
    const tpl = await this.bot.template(key, locale, vars);
    if (!tpl) return;
    await this.bot.sendRecorded(
      chatId,
      { text: html(tpl.text), inline: tpl.buttons },
      { customerId, templateKey: key },
    );
  }

  /** Customer photo → private bucket + File row (JPEG/PNG/WebP by magic bytes, ≤ 10 MB). */
  async storePhoto(telegramFileId: string, prefix: string): Promise<string | null> {
    try {
      const bytes = await this.gateway.download(telegramFileId);
      if (!bytes || bytes.length > BOT_LIMITS.photoMaxBytes) return null;
      const meta = imageMeta(bytes);
      if (!meta) return null;
      const key = `${prefix}/${randomBytes(12).toString('base64url')}.${meta.ext}`;
      await this.files.put(key, bytes, meta.mime, false);
      const file = await this.prisma.file.create({
        data: {
          key,
          isPublic: false,
          mime: meta.mime,
          size: bytes.length,
          width: meta.width,
          height: meta.height,
        },
        select: { id: true },
      });
      return file.id;
    } catch (e) {
      this.logger.warn(`photo download failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** Conversation of a review complaint (1–3★): straight to COMPLAINT with the rating as text. */
  async reviewComplaint(
    chatId: bigint,
    customerId: string,
    text: string,
    now = new Date(),
  ): Promise<string> {
    const existing = await this.open(chatId);
    const data: Prisma.ConversationUncheckedCreateInput = {
      telegramChatId: chatId,
      customerId,
      topic: 'review',
      status: 'COMPLAINT',
      lastMessageAt: now,
    };
    const conv = existing
      ? await this.prisma.conversation.update({
          where: { id: existing.id },
          data: { status: 'COMPLAINT', lastMessageAt: now, topic: 'review' },
        })
      : await this.prisma.conversation.create({ data });
    await this.prisma.conversationMessage.create({
      data: { conversationId: conv.id, fromCustomer: true, text, fileIds: [], createdAt: now },
    });
    return conv.id;
  }
}
