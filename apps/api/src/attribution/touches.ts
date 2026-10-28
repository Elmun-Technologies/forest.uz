import type { AttributionTouch } from '@forest/contracts';
import { Prisma } from '@forest/db';
import { sessionCampaign, sessionMedium, sessionSource } from '../admin/analytics/sql';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Journey touches of a customer (docs/07 "Attribution", CLAUDE.md §6): sessions of the customer
 * and of every visitor linked to them (+ the order's own visitor/session), Telegram bot
 * conversations they started and marketing messages sent to them, in (`after`, `until`].
 */
export interface TouchScope {
  customerId: string;
  /** Exclusive lower bound. */
  after: Date;
  /** Inclusive upper bound. */
  until: Date;
  anonymousId?: string | null;
  sessionId?: string | null;
  limit: number;
}

export interface SessionTouchRow {
  id: string;
  startedAt: Date;
  channel: string;
  source: string;
  medium: string;
  campaign: string | null;
}

/**
 * Sessions belonging to the customer: stamped with them, or anonymous sessions of a visitor
 * linked to them / of the order's own visitor, plus the order's own session. A visitor id is a
 * device: a session stamped with ANOTHER customer (shared phone, latest identity wins) never
 * counts for this one.
 */
export function customerSessionsWhere(scope: {
  customerId: string;
  anonymousId?: string | null;
  sessionId?: string | null;
}): Prisma.Sql {
  const mineOrAnonymous = Prisma.sql`(s."customerId" IS NULL OR s."customerId" = ${scope.customerId})`;
  const extra: Prisma.Sql[] = [];
  if (scope.anonymousId)
    extra.push(Prisma.sql`OR (s."anonymousId" = ${scope.anonymousId} AND ${mineOrAnonymous})`);
  if (scope.sessionId) extra.push(Prisma.sql`OR s.id = ${scope.sessionId}`);
  return Prisma.sql`(s."customerId" = ${scope.customerId}
    OR (s."anonymousId" IN (SELECT v."anonymousId" FROM "Visitor" v WHERE v."customerId" = ${scope.customerId})
        AND ${mineOrAnonymous})
    ${extra.length ? Prisma.join(extra, ' ') : Prisma.empty})`;
}

export async function loadSessionTouches(
  prisma: PrismaService,
  scope: TouchScope,
): Promise<SessionTouchRow[]> {
  return prisma.$queryRaw<SessionTouchRow[]>`
    SELECT s.id, s."startedAt", s.channel,
           ${sessionSource('s')} AS source, ${sessionMedium('s')} AS medium,
           ${sessionCampaign('s')} AS campaign
    FROM "Session" s
    WHERE ${customerSessionsWhere(scope)}
      AND s."startedAt" > ${scope.after} AND s."startedAt" <= ${scope.until}
    ORDER BY s."startedAt" DESC
    LIMIT ${scope.limit}`;
}

export async function loadTouches(
  prisma: PrismaService,
  scope: TouchScope,
): Promise<AttributionTouch[]> {
  const [sessions, conversations, messages] = await Promise.all([
    loadSessionTouches(prisma, scope),
    prisma.$queryRaw<{ at: Date; topic: string }[]>`
      SELECT MIN(m."createdAt") AS at, c.topic
      FROM "Conversation" c JOIN "ConversationMessage" m ON m."conversationId" = c.id
      WHERE c."customerId" = ${scope.customerId} AND m."fromCustomer" = true
      GROUP BY c.id, c.topic
      HAVING MIN(m."createdAt") > ${scope.after} AND MIN(m."createdAt") <= ${scope.until}
      ORDER BY at DESC LIMIT ${scope.limit}`,
    prisma.message.findMany({
      where: {
        customerId: scope.customerId,
        marketing: true,
        status: { in: ['SENT', 'DELIVERED'] },
        sentAt: { gt: scope.after, lte: scope.until },
      },
      orderBy: { sentAt: 'desc' },
      take: scope.limit,
      select: { channel: true, templateKey: true, sentAt: true },
    }),
  ]);
  return [
    ...sessions.map((s): AttributionTouch => ({
      at: s.startedAt.toISOString(),
      kind: 'session',
      channel: s.channel,
      source: s.source,
      medium: s.medium,
      campaign: s.campaign,
      sessionId: s.id,
    })),
    ...conversations.map((c): AttributionTouch => ({
      at: c.at.toISOString(),
      kind: 'bot',
      channel: 'bot',
      source: 'telegram',
      medium: 'bot',
      campaign: c.topic,
      sessionId: null,
    })),
    ...messages.map((m): AttributionTouch => ({
      at: m.sentAt!.toISOString(),
      kind: 'message',
      channel: m.channel === 'SMS' ? 'sms' : 'bot',
      source: m.channel === 'SMS' ? 'sms' : 'telegram',
      medium: m.channel === 'SMS' ? 'sms' : 'bot',
      campaign: m.templateKey,
      sessionId: null,
    })),
  ];
}

/** The order itself when no visit/message is known (phone, bot or untracked web order). */
export function orderTouch(order: { createdAt: Date; source: string }): AttributionTouch {
  const channel = order.source === 'bot' ? 'bot' : order.source === 'phone' ? 'phone' : 'direct';
  return {
    at: order.createdAt.toISOString(),
    kind: 'order',
    channel,
    source: channel === 'direct' ? '(direct)' : channel === 'bot' ? 'telegram' : 'phone',
    medium: channel === 'direct' ? '(none)' : channel,
    campaign: null,
    sessionId: null,
  };
}
