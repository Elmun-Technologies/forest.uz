import { Injectable, Logger } from '@nestjs/common';
import {
  type AdminMessageTemplateDto,
  CUSTOM_TEMPLATE_PREFIX,
  DomainError,
  hasPermission,
  MESSAGE_TEMPLATES,
  type MessageStatsDto,
  type MessageTemplateCreateInput,
  type MessageTemplateTestInput,
  type MessageTemplateUpdateInput,
  type MessageTestResultDto,
  type MessagingSettingsDto,
  type MessagingSettingsInput,
  maskUzPhone,
  renderTemplate,
  settingSchemas,
  type TemplateButton,
  templateExampleVars,
  templateMeta,
  templateProblems,
} from '@forest/contracts';
import { Prisma, type MessageTemplate } from '@forest/db';
import { IntegrationsService } from '../../integrations/integrations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { messagingSettingsProblems } from './settings-guard';

type Tx = Prisma.TransactionClient;
const DAY_MS = 86_400_000;
/** Templates whose delay is also the automation setting (A4 "abandoned" segment reads it). */
const DELAY_SETTINGS: Record<string, 'abandonedCartMinutes' | 'reviewRequestDays'> = {
  cart_abandoned_2h: 'abandonedCartMinutes',
  review_request: 'reviewRequestDays',
};

/** JSON with sorted keys: jsonb reorders object keys, so plain stringify can't compare. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * A12 template editor + messaging settings (CLAUDE.md §6). Every mutation is one transaction with
 * its audit row; template texts are validated against the catalog's variables per key.
 */
@Injectable()
export class AdminMessagingService {
  private readonly logger = new Logger('AdminMessaging');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
    private readonly audit: AuditService,
  ) {}

  async templates(): Promise<AdminMessageTemplateDto[]> {
    const [rows, stats] = await Promise.all([
      this.prisma.messageTemplate.findMany(),
      this.prisma.message.groupBy({
        by: ['templateKey', 'status'],
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) },
          templateKey: { not: null },
        },
        _count: { _all: true },
      }),
    ]);
    const statsOf = (key: string): MessageStatsDto => {
      const out = { sent: 0, skipped: 0, failed: 0 };
      for (const s of stats.filter((x) => x.templateKey === key)) {
        if (s.status === 'SENT' || s.status === 'DELIVERED') out.sent += s._count._all;
        else if (s.status === 'FAILED') out.failed += s._count._all;
        else if (s.status !== 'QUEUED') out.skipped += s._count._all;
      }
      return out;
    };
    const order = Object.keys(MESSAGE_TEMPLATES);
    const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
    return rows
      .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key))
      .map((r) => this.dto(r, statsOf(r.key)));
  }

  private dto(r: MessageTemplate, stats: MessageStatsDto): AdminMessageTemplateDto {
    const meta = templateMeta(r.key);
    const body = r.body as { uz?: string; ru?: string };
    return {
      key: r.key,
      label: meta?.label ?? r.key,
      kind: meta?.kind ?? 'service',
      scenario: meta?.scenario ?? 'order',
      vars: [...(meta?.vars ?? [])],
      channels: [...(meta?.channels ?? ['SMS'])],
      custom: r.key.startsWith(CUSTOM_TEMPLATE_PREFIX),
      body: { uz: body.uz ?? '', ru: body.ru ?? '' },
      buttons: Array.isArray(r.buttons) ? (r.buttons as unknown as TemplateButton[]) : [],
      delayMin: r.delayMin,
      smsFallback: r.smsFallback,
      smsApproved: r.smsApproved,
      active: r.active,
      updatedAt: r.updatedAt.toISOString(),
      stats,
    };
  }

  private assertValid(
    key: string,
    input: Pick<MessageTemplateUpdateInput, 'body' | 'buttons' | 'delayMin'>,
  ): void {
    if (!templateMeta(key)) throw new DomainError('NOT_FOUND');
    const problems = templateProblems({ key, body: input.body, buttons: input.buttons });
    if (DELAY_SETTINGS[key] && input.delayMin < 1)
      problems.push({ field: 'delayMin', code: 'empty' });
    if (problems.length)
      throw new DomainError('MESSAGE_TEMPLATE_INVALID', { problems }, problems[0]!.field);
  }

  async update(
    actor: AuditActor,
    key: string,
    input: MessageTemplateUpdateInput,
  ): Promise<AdminMessageTemplateDto> {
    this.assertValid(key, input);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MessageTemplate" WHERE "key" = ${key} FOR UPDATE`;
      const before = await tx.messageTemplate.findUnique({ where: { key } });
      if (!before) throw new DomainError('NOT_FOUND');
      // Eskiz approves an exact text: a changed body keeps the approval only when this request
      // explicitly attests the new wording is approved (`smsReapproved`).
      const prevBody = before.body as { uz?: string; ru?: string };
      const bodyChanged = prevBody.uz !== input.body.uz || prevBody.ru !== input.body.ru;
      const next = {
        body: input.body,
        buttons: input.buttons.length ? input.buttons : null,
        delayMin: input.delayMin,
        smsFallback: input.smsFallback,
        smsApproved: bodyChanged ? input.smsApproved && input.smsReapproved : input.smsApproved,
        active: input.active,
      };
      await tx.messageTemplate.update({
        where: { key },
        data: { ...next, buttons: next.buttons ?? Prisma.JsonNull },
      });
      const prev = {
        body: before.body,
        buttons: before.buttons,
        delayMin: before.delayMin,
        smsFallback: before.smsFallback,
        smsApproved: before.smsApproved,
        active: before.active,
      };
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
        (k) => canonical(prev[k]) !== canonical(next[k]),
      );
      const setting = DELAY_SETTINGS[key];
      if (setting && changed.includes('delayMin'))
        await this.syncDelaySetting(tx, actor, setting, input.delayMin);
      await this.audit.record(
        actor,
        {
          action: 'message_template.update',
          entity: 'MessageTemplate',
          entityId: key,
          before: Object.fromEntries(changed.map((k) => [k, prev[k]])),
          after: changed.length
            ? Object.fromEntries(changed.map((k) => [k, next[k]]))
            : { unchanged: true },
        },
        tx,
      );
    });
    this.settings.invalidate();
    return this.one(key);
  }

  /** The automation delay lives in the template; `messaging.rules` mirrors it (A4 reads it). */
  private async syncDelaySetting(
    tx: Tx,
    actor: AuditActor,
    field: 'abandonedCartMinutes' | 'reviewRequestDays',
    delayMin: number,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "key" FROM "Setting" WHERE "key" = 'messaging.rules' FOR UPDATE`;
    const row = await tx.setting.findUnique({ where: { key: 'messaging.rules' } });
    const current = settingSchemas['messaging.rules'].parse(row?.value);
    const value =
      field === 'abandonedCartMinutes' ? delayMin : Math.max(1, Math.round(delayMin / 1440));
    if (current[field] === value) return;
    await tx.setting.update({
      where: { key: 'messaging.rules' },
      data: { value: { ...current, [field]: value }, updatedBy: actor.staffId },
    });
  }

  async create(
    actor: AuditActor,
    input: MessageTemplateCreateInput,
  ): Promise<AdminMessageTemplateDto> {
    const { key, ...fields } = input;
    this.assertValid(key, fields);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.messageTemplate.create({
          data: {
            key,
            ...fields,
            buttons: fields.buttons.length ? fields.buttons : Prisma.JsonNull,
          },
        });
        await this.audit.record(
          actor,
          {
            action: 'message_template.create',
            entity: 'MessageTemplate',
            entityId: key,
            after: fields,
          },
          tx,
        );
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new DomainError('MESSAGE_TEMPLATE_EXISTS', undefined, 'key');
      throw e;
    }
    return this.one(key);
  }

  /** Only admin-created (`custom_*`) templates, and only while no audience automation uses them. */
  async remove(actor: AuditActor, key: string): Promise<void> {
    if (!key.startsWith(CUSTOM_TEMPLATE_PREFIX)) throw new DomainError('NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.messageTemplate.findUnique({ where: { key } });
      if (!before) throw new DomainError('NOT_FOUND');
      const used = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM "Segment"
        WHERE "autoMessage" -> 'steps' @> ${JSON.stringify([{ templateKey: key }])}::jsonb`;
      if (Number(used[0]?.n ?? 0) > 0) throw new DomainError('MESSAGE_TEMPLATE_IN_USE');
      await tx.messageTemplate.delete({ where: { key } });
      await this.audit.record(
        actor,
        {
          action: 'message_template.delete',
          entity: 'MessageTemplate',
          entityId: key,
          before: { body: before.body },
        },
        tx,
      );
    });
  }

  private async one(key: string): Promise<AdminMessageTemplateDto> {
    const all = await this.templates();
    const found = all.find((t) => t.key === key);
    if (!found) throw new DomainError('NOT_FOUND');
    return found;
  }

  /**
   * "O'zimga test": the saved template rendered with example values — exactly the approved text,
   * no prefix or extra lines (Eskiz rejects anything else) — by SMS to the staff member's own
   * phone (only an Eskiz-approved text). Not a customer message → no `Message` row; audited.
   */
  async test(
    actor: AuditActor,
    key: string,
    input: MessageTemplateTestInput,
  ): Promise<MessageTestResultDto> {
    const [template, staff] = await Promise.all([
      this.prisma.messageTemplate.findUnique({ where: { key } }),
      actor.staffId
        ? this.prisma.staff.findUnique({
            where: { id: actor.staffId },
            select: { name: true, phone: true },
          })
        : null,
    ]);
    if (!template) throw new DomainError('NOT_FOUND');
    if (!staff?.phone) throw new DomainError('MESSAGE_TEST_NO_CONTACT');
    if (!template.smsApproved) throw new DomainError('MESSAGE_TEST_SMS_NOT_APPROVED');
    const vars: Record<string, string> = {
      ...templateExampleVars(key, input.locale),
      ism: staff.name.split(' ')[0] ?? '',
    };
    const body = template.body as { uz: string; ru: string };
    const text = renderTemplate(body[input.locale] ?? '', vars);
    if (text === null) throw new DomainError('MESSAGE_TEMPLATE_INVALID');
    try {
      const sms = await this.integrations.sms();
      await sms.send({
        phone: staff.phone,
        text,
        templateKey: key,
      });
    } catch (e) {
      this.logger.warn(`test message ${key} failed: ${String(e)}`);
      await this.audit.record(actor, {
        action: 'message_template.test',
        entity: 'MessageTemplate',
        entityId: key,
        after: { channel: 'SMS', locale: input.locale, ok: false },
      });
      throw new DomainError('MESSAGE_TEST_FAILED');
    }
    await this.audit.record(actor, {
      action: 'message_template.test',
      entity: 'MessageTemplate',
      entityId: key,
      after: { channel: 'SMS', locale: input.locale, ok: true },
    });
    return { channel: 'SMS', to: maskUzPhone(staff.phone) };
  }

  // ───────── settings ─────────

  private async settingsRow(db: Tx | PrismaService = this.prisma) {
    const row = await db.setting.findUnique({ where: { key: 'messaging.rules' } });
    return {
      value: settingSchemas['messaging.rules'].parse(row?.value),
      version: row?.updatedAt.toISOString() ?? 'none',
    };
  }

  async getSettings(): Promise<MessagingSettingsDto> {
    const [{ value, version }, integrations, staff] = await Promise.all([
      this.settingsRow(),
      this.integrations.list(),
      this.prisma.staff.findMany({
        where: { active: true },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const tg = integrations.find((i) => i.definition.key === 'telegram');
    return {
      value: {
        marketingPerDay: value.marketingPerDay,
        quietStart: value.quietStart,
        quietEnd: value.quietEnd,
        operatorDays: value.operatorDays,
        operatorStart: value.operatorStart,
        operatorEnd: value.operatorEnd,
        operatorIds: value.operatorIds,
        languages: value.languages,
        scenarios: value.scenarios,
        abandonedCartMinutes: value.abandonedCartMinutes,
        reviewRequestDays: value.reviewRequestDays,
      },
      version,
      bot: {
        status: tg?.status ?? 'DISCONNECTED',
        username: tg?.fields.botUsername ?? null,
        tokenMasked: tg?.fields.botToken ?? null,
      },
      operatorOptions: staff
        .filter((s) => hasPermission(s.role, 'bot.inbox'))
        .map((s) => ({ id: s.id, name: s.name })),
    };
  }

  /** `ownerLevel` = the actor holds `settings.store` (Owner): wider cap / quiet-window bounds. */
  async saveSettings(
    actor: AuditActor,
    input: MessagingSettingsInput,
    ownerLevel: boolean,
  ): Promise<MessagingSettingsDto> {
    const { version, ...fields } = input;
    const unsafe = messagingSettingsProblems(fields, ownerLevel);
    if (unsafe.length)
      throw new DomainError('MESSAGING_SETTINGS_UNSAFE', { problems: unsafe }, unsafe[0]!.field);
    if (fields.operatorIds.length) {
      const ok = await this.prisma.staff.findMany({
        where: { id: { in: fields.operatorIds }, active: true },
        select: { role: true },
      });
      if (
        ok.length !== fields.operatorIds.length ||
        !ok.every((s) => hasPermission(s.role, 'bot.inbox'))
      )
        throw new DomainError('VALIDATION_FAILED', undefined, 'operatorIds');
    }
    await this.prisma.$transaction(async (tx) => {
      // Serialises saves of this row (and 5A's scenario switches) so the version check is exact.
      await tx.$queryRaw`SELECT "key" FROM "Setting" WHERE "key" = 'messaging.rules' FOR UPDATE`;
      const current = await this.settingsRow(tx);
      if (current.version !== version) throw new DomainError('SETTINGS_CONFLICT');
      const next = settingSchemas['messaging.rules'].parse({ ...current.value, ...fields });
      const keys = (Object.keys(next) as (keyof typeof next)[]).filter(
        (k) => JSON.stringify(current.value[k]) !== JSON.stringify(next[k]),
      );
      if (keys.length)
        await tx.setting.update({
          where: { key: 'messaging.rules' },
          data: { value: next as unknown as Prisma.InputJsonValue, updatedBy: actor.staffId },
        });
      await this.audit.record(
        actor,
        {
          action: 'settings.messaging.update',
          entity: 'Setting',
          entityId: 'messaging.rules',
          before: keys.length
            ? Object.fromEntries(keys.map((k) => [k, current.value[k]]))
            : undefined,
          after: keys.length
            ? Object.fromEntries(keys.map((k) => [k, next[k]]))
            : { unchanged: true },
        },
        tx,
      );
    });
    this.settings.invalidate();
    return this.getSettings();
  }
}
