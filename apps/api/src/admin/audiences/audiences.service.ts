import { Injectable } from '@nestjs/common';
import {
  AD_DESTINATION_INTEGRATION,
  AD_DESTINATIONS,
  type AdminSegmentDto,
  type AdminSegmentListDto,
  type AdminSegmentMembersDto,
  type AudienceAutoMessage,
  type AudienceDestination,
  type AudienceRules,
  type AudienceSizeDto,
  audienceAutoMessageSchema,
  audienceRulesSchema,
  AUDIENCE_DESTINATIONS,
  AUDIENCE_PRESET_KEYS,
  DomainError,
  maskUzPhone,
  templateMeta,
  type SegmentCreateInput,
  type SegmentDestinationStateDto,
  type SegmentSyncStatus,
  type SegmentUpdateInput,
} from '@forest/contracts';
import { Prisma, type Segment } from '@forest/db';
import { AdSignalsService } from '../../audiences/ad-signals.service';
import { AdsProvidersService } from '../../audiences/ads-providers.service';
import { AudienceService } from '../../audiences/audience.service';
import { AudienceJobs } from '../../audiences/audiences.module';
import { consentGranted } from '../../audiences/compile';
import { PrismaService } from '../../prisma/prisma.service';
import { type AuditActor, AuditService } from '../audit/audit.service';

type SegmentWithStates = Segment & {
  destinationStates: {
    destination: string;
    status: string;
    members: number;
    lastSyncAt: Date | null;
    lastError: string | null;
  }[];
};

const isDestination = (d: string): d is AudienceDestination =>
  (AUDIENCE_DESTINATIONS as readonly string[]).includes(d);

/** Fields recorded in the audit log (rules and config are not PII). */
function auditView(s: {
  name: string;
  description: string | null;
  rules: unknown;
  destinations: string[];
  autoMessage: unknown;
  active: boolean;
}) {
  return {
    name: s.name,
    description: s.description,
    rules: s.rules,
    destinations: s.destinations,
    autoMessage: s.autoMessage ?? null,
    active: s.active,
  };
}

function encodeCursor(addedAt: Date, id: string): string {
  return Buffer.from(`${addedAt.getTime()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!ms || !id || !/^\d+$/.test(ms))
    throw new DomainError('VALIDATION_FAILED', undefined, 'cursor');
  return { at: new Date(Number(ms)), id };
}

/** A8 Auditoriyalar (CLAUDE.md §6 "Audiences"): list, editor, live size, members (masked). */
@Injectable()
export class AdminAudiencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly audiences: AudienceService,
    private readonly jobs: AudienceJobs,
    private readonly ads: AdsProvidersService,
    private readonly signals: AdSignalsService,
  ) {}

  private async connected(): Promise<Set<string>> {
    return this.ads.connectedKeys(Object.values(AD_DESTINATION_INTEGRATION));
  }

  private async toDto(s: SegmentWithStates, connected: Set<string>): Promise<AdminSegmentDto> {
    const rules = audienceRulesSchema.safeParse(s.rules);
    const autoMessage = audienceAutoMessageSchema.safeParse(s.autoMessage);
    const destinations = s.destinations.filter(isDestination);
    const states: SegmentDestinationStateDto[] = AUDIENCE_DESTINATIONS.map((destination) => {
      const st = s.destinationStates.find((x) => x.destination === destination);
      const ad = (AD_DESTINATIONS as readonly string[]).includes(destination);
      const enabled = destinations.includes(destination);
      return {
        destination,
        enabled,
        status: (st?.status as SegmentSyncStatus | undefined) ?? (enabled ? 'pending' : 'off'),
        members: st?.members ?? 0,
        lastSyncAt: st?.lastSyncAt?.toISOString() ?? null,
        lastError: st?.lastError ?? null,
        connected: ad
          ? connected.has(
              AD_DESTINATION_INTEGRATION[destination as (typeof AD_DESTINATIONS)[number]],
            )
          : false,
      };
    });
    return {
      id: s.id,
      key: s.key,
      name: s.name,
      description: s.description,
      rules: rules.success ? (rules.data as AudienceRules) : { groups: [] },
      destinations,
      autoMessage: autoMessage.success ? (autoMessage.data as AudienceAutoMessage) : null,
      active: s.active,
      size: s.size,
      refreshedAt: s.refreshedAt?.toISOString() ?? null,
      refreshError: s.refreshError,
      lastAdded: s.lastAdded,
      lastRemoved: s.lastRemoved,
      destinationStates: states,
      result: await this.audiences.result(s.id),
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async list(): Promise<AdminSegmentListDto> {
    const [rows, connected, signals, templates, products] = await Promise.all([
      this.prisma.segment.findMany({
        include: { destinationStates: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.connected(),
      this.signals.summary(),
      this.prisma.messageTemplate.findMany({
        where: { active: true },
        select: { key: true, body: true },
        orderBy: { key: 'asc' },
      }),
      this.prisma.product.findMany({
        where: { status: { not: 'ARCHIVED' } },
        select: { id: true, name: true, slug: true },
        orderBy: { slug: 'asc' },
        take: 500,
      }),
    ]);
    const rank = (key: string | null) => {
      const i = (AUDIENCE_PRESET_KEYS as readonly string[]).indexOf(key ?? '');
      return i === -1 ? AUDIENCE_PRESET_KEYS.length : i;
    };
    rows.sort((a, b) => rank(a.key) - rank(b.key));
    const items: AdminSegmentDto[] = [];
    for (const r of rows) items.push(await this.toDto(r, connected));
    return {
      items,
      signals,
      templates: templates
        .filter((t) => templateMeta(t.key)?.kind === 'marketing')
        .map((t) => {
          const body = (t.body ?? {}) as { uz?: unknown };
          const channels = templateMeta(t.key)?.channels ?? [];
          return {
            key: t.key,
            preview: typeof body.uz === 'string' ? body.uz.slice(0, 160) : '',
            channels: channels.map((c) => (c === 'SMS' ? ('sms' as const) : ('telegram' as const))),
          };
        }),
      products: products.map((p) => {
        const name = (p.name ?? {}) as { uz?: unknown };
        return { id: p.id, slug: p.slug, name: typeof name.uz === 'string' ? name.uz : p.slug };
      }),
      fakeMode: this.ads.fakeMode,
    };
  }

  async get(id: string): Promise<AdminSegmentDto> {
    const row = await this.prisma.segment.findUnique({
      where: { id },
      include: { destinationStates: true },
    });
    if (!row) throw new DomainError('NOT_FOUND');
    return this.toDto(row, await this.connected());
  }

  async preview(rules: AudienceRules): Promise<AudienceSizeDto> {
    await this.audiences.assertProducts(rules);
    return this.audiences.preview(rules);
  }

  /**
   * A segment automation sends marketing: only marketing templates (cart reminders, review
   * requests, admin `custom_*`) on a channel the template supports — never a service text such
   * as `advice_received` or an OTP.
   */
  private async assertTemplates(autoMessage: AudienceAutoMessage | null | undefined) {
    const steps = autoMessage?.steps ?? [];
    if (!steps.length) return;
    for (const s of steps) {
      const meta = templateMeta(s.templateKey);
      if (!meta || meta.kind !== 'marketing')
        throw new DomainError('AUDIENCE_TEMPLATE_NOT_MARKETING', { key: s.templateKey });
      if (!meta.channels.includes(s.channel === 'sms' ? 'SMS' : 'TELEGRAM'))
        throw new DomainError('AUDIENCE_TEMPLATE_NOT_MARKETING', { key: s.templateKey });
    }
    const keys = [...new Set(steps.map((s) => s.templateKey))];
    const found = await this.prisma.messageTemplate.count({ where: { key: { in: keys } } });
    if (found !== keys.length) throw new DomainError('AUDIENCE_TEMPLATE_NOT_FOUND');
  }

  async create(actor: AuditActor, input: SegmentCreateInput): Promise<AdminSegmentDto> {
    await this.audiences.assertProducts(input.rules);
    await this.assertTemplates(input.autoMessage);
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.segment.create({
        data: {
          name: input.name,
          description: input.description,
          rules: input.rules as Prisma.InputJsonValue,
          destinations: input.destinations,
          autoMessage: input.autoMessage
            ? (input.autoMessage as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          active: input.active,
        },
      });
      await this.audit.record(
        actor,
        {
          action: 'segment.create',
          entity: 'Segment',
          entityId: created.id,
          after: auditView(created),
        },
        tx,
      );
      return created.id;
    });
    await this.jobs.enqueueSegment(id);
    return this.get(id);
  }

  async update(actor: AuditActor, id: string, input: SegmentUpdateInput): Promise<AdminSegmentDto> {
    if (input.rules) await this.audiences.assertProducts(input.rules);
    if (input.autoMessage) await this.assertTemplates(input.autoMessage);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Segment" WHERE id = ${id} FOR UPDATE`;
      const before = await tx.segment.findUnique({ where: { id } });
      if (!before) throw new DomainError('NOT_FOUND');
      const after = await tx.segment.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.rules !== undefined ? { rules: input.rules as Prisma.InputJsonValue } : {}),
          ...(input.destinations !== undefined ? { destinations: input.destinations } : {}),
          ...(input.autoMessage !== undefined
            ? {
                autoMessage: input.autoMessage
                  ? (input.autoMessage as Prisma.InputJsonValue)
                  : Prisma.JsonNull,
              }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      const prev = auditView(before);
      const next = auditView(after);
      const keys = (Object.keys(next) as (keyof typeof next)[]).filter(
        (k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]),
      );
      await this.audit.record(
        actor,
        {
          action: 'segment.update',
          entity: 'Segment',
          entityId: id,
          before: Object.fromEntries(keys.map((k) => [k, prev[k]])),
          after: Object.fromEntries(keys.map((k) => [k, next[k]])),
        },
        tx,
      );
    });
    await this.jobs.enqueueSegment(id);
    return this.get(id);
  }

  async refreshNow(actor: AuditActor, id: string): Promise<{ queued: true }> {
    const row = await this.prisma.segment.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new DomainError('NOT_FOUND');
    await this.audit.record(actor, { action: 'segment.refresh', entity: 'Segment', entityId: id });
    await this.jobs.enqueueSegment(id);
    return { queued: true };
  }

  /** Current members, newest first; phones masked (no reveal on A8). */
  async members(
    id: string,
    q: { cursor?: string; limit: number },
  ): Promise<AdminSegmentMembersDto> {
    const c = q.cursor ? decodeCursor(q.cursor) : null;
    const rows = await this.prisma.$queryRaw<
      {
        customerId: string;
        publicId: string;
        phone: string | null;
        hasTelegram: boolean;
        adsConsent: boolean;
        addedAt: Date;
      }[]
    >(Prisma.sql`
      SELECT c.id AS "customerId", c."publicId", c.phone, c."telegramId" IS NOT NULL AS "hasTelegram",
             ${consentGranted('ads')} AS "adsConsent", sm."addedAt"
      FROM "SegmentMember" sm JOIN "Customer" c ON c.id = sm."customerId"
      WHERE sm."segmentId" = ${id} AND sm."removedAt" IS NULL AND c."deletedAt" IS NULL
        ${c ? Prisma.sql`AND (sm."addedAt" < ${c.at} OR (sm."addedAt" = ${c.at} AND c.id < ${c.id}))` : Prisma.empty}
      ORDER BY sm."addedAt" DESC, c.id DESC
      LIMIT ${q.limit + 1}`);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        customerId: r.customerId,
        publicId: r.publicId,
        phoneMasked: r.phone ? maskUzPhone(r.phone) : null,
        hasTelegram: r.hasTelegram,
        adsConsent: r.adsConsent,
        addedAt: r.addedAt.toISOString(),
      })),
      nextCursor:
        rows.length > q.limit && last ? encodeCursor(last.addedAt, last.customerId) : null,
    };
  }
}
