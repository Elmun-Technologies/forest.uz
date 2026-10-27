import {
  allocateByShares,
  ATTRIBUTION_MODELS,
  type CustomerJourneyDto,
  DomainError,
  type JourneySessionDto,
  type OrderJourneyDto,
  parseOrderAttribution,
  type TouchDto,
} from '@forest/contracts';
import { Prisma } from '@forest/db';
import { Injectable } from '@nestjs/common';
import { customerSessionsWhere, loadTouches } from '../../attribution/touches';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isPurchase,
  num,
  platformOf,
  revenueOf,
  sessionCampaign,
  sessionMedium,
  sessionSource,
  soum,
  tashkentDay,
} from './sql';

const DAY_MS = 86_400_000;
/** No upper bound for the A5 journey (clock skew must not hide a session). */
const FOREVER = new Date('9999-12-31T00:00:00Z');
/** Sessions listed on A5 (the summary counts all). */
export const JOURNEY_SESSIONS = 50;

const touchDto = (x: TouchDto): TouchDto => ({
  at: x.at,
  kind: x.kind,
  channel: x.channel,
  source: x.source,
  medium: x.medium,
  campaign: x.campaign,
});

/** A5 customer journey + attribution summary, A7 order journey (docs/07 "Attribution"). */
@Injectable()
export class JourneyService {
  constructor(private readonly prisma: PrismaService) {}

  async customer(customerId: string, now = new Date()): Promise<CustomerJourneyDto> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) throw new DomainError('NOT_FOUND');
    const where = customerSessionsWhere({ customerId });
    const [sessions, [counts], [firstPurchase], touches] = await Promise.all([
      this.prisma.$queryRaw<
        {
          id: string;
          startedAt: Date;
          durationSec: number;
          pageviews: number;
          channel: string;
          source: string;
          medium: string;
          campaign: string | null;
          landingPath: string;
          device: string;
          region: string | null;
          hasReplay: boolean;
          vi: bigint;
          atc: bigint;
          bc: boolean;
          lead: boolean;
          orderNumber: string | null;
        }[]
      >`
        SELECT s.id, s."startedAt", s."durationSec", s.pageviews, s.channel,
               ${sessionSource('s')} AS source, ${sessionMedium('s')} AS medium,
               ${sessionCampaign('s')} AS campaign, s."landingPath", s.device, s.region,
               s."hasReplay", ev.vi, ev.atc, ev.bc, ev.lead,
               (SELECT o.number FROM "Order" o WHERE o."sessionId" = s.id
                 ORDER BY o."createdAt" LIMIT 1) AS "orderNumber"
        FROM "Session" s
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE e.name = 'view_item') AS vi,
                 count(*) FILTER (WHERE e.name = 'add_to_cart') AS atc,
                 bool_or(e.name = 'begin_checkout') AS bc,
                 bool_or(e.name = 'lead') AS lead
          FROM "Event" e
          WHERE e."sessionId" = s.id AND e.ts >= s."startedAt" - interval '1 minute'
            AND e.ts <= s."endedAt" + interval '30 minutes') ev ON true
        WHERE ${where}
        ORDER BY s."startedAt" DESC LIMIT ${JOURNEY_SESSIONS}`,
      this.prisma.$queryRaw<{ n: bigint; first: Date | null }[]>`
        SELECT count(*) AS n, min(s."startedAt") AS first FROM "Session" s WHERE ${where}`,
      this.prisma.$queryRaw<{ at: Date | null }[]>`
        SELECT min(o."createdAt") AS at FROM "Order" o
        WHERE o."customerId" = ${customerId} AND ${isPurchase('o')}`,
      loadTouches(this.prisma, {
        customerId,
        after: new Date(0),
        until: FOREVER,
        limit: 500,
      }),
    ]);
    touches.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const firstSession = counts?.first ?? null;
    const purchaseAt = firstPurchase?.at ?? null;
    return {
      sessions: sessions.map((s): JourneySessionDto => ({
        id: s.id,
        startedAt: s.startedAt.toISOString(),
        durationSec: s.durationSec,
        pageviews: s.pageviews,
        channel: s.channel,
        source: s.source,
        medium: s.medium,
        campaign: s.campaign,
        landingPath: s.landingPath,
        device: s.device,
        region: s.region,
        viewedItems: num(s.vi),
        addedToCart: num(s.atc),
        beganCheckout: s.bc === true,
        lead: s.lead === true,
        orderNumber: s.orderNumber,
        hasReplay: s.hasReplay,
      })),
      truncated: num(counts?.n) > sessions.length,
      summary: {
        sessions: num(counts?.n),
        firstTouch: touches[0] ? touchDto(touches[0]) : null,
        lastTouch: touches.at(-1) ? touchDto(touches.at(-1)!) : null,
        channels: [...new Set(touches.map((x) => x.channel))],
        visitToPurchaseDays:
          firstSession && purchaseAt && firstSession <= purchaseAt
            ? Math.round(((purchaseAt.getTime() - firstSession.getTime()) / DAY_MS) * 10) / 10
            : null,
        cacSoum: await this.cac(customerId, purchaseAt ?? now),
      },
    };
  }

  /**
   * Allocated ad spend (CLAUDE.md §6): for each campaign-day the customer visited from a paid
   * campaign up to `until`, that day's spend × their sessions / all its sessions.
   */
  async cac(customerId: string, until: Date): Promise<number | null> {
    const src = sessionSource('s');
    const src2 = sessionSource('s2');
    const [row] = await this.prisma.$queryRaw<{ cac: unknown; paid: bigint }[]>`
      WITH cs AS (
        SELECT ${tashkentDay(Prisma.sql`s."startedAt"`)} AS d, ${platformOf(src)} AS pl,
               lower(${sessionCampaign('s')}) AS c
        FROM "Session" s
        WHERE ${customerSessionsWhere({ customerId })} AND s."startedAt" <= ${until}),
      mine AS (
        SELECT d, pl, c, count(*) AS n FROM cs
        WHERE pl IS NOT NULL AND c IS NOT NULL GROUP BY d, pl, c),
      sp AS (
        SELECT m.d, m.pl, m.c, m.n, SUM(a."spendTiyin") AS spend
        FROM mine m JOIN "AdSpendDaily" a ON a.date = m.d AND a.platform = m.pl
          AND (lower(a.campaign) = m.c OR lower(a."campaignId") = m.c)
        GROUP BY m.d, m.pl, m.c, m.n),
      tot AS (
        SELECT sp.*, (
          SELECT count(*) FROM "Session" s2
          WHERE s2."startedAt" >= (sp.d::timestamp AT TIME ZONE 'Asia/Tashkent')
            AND s2."startedAt" < ((sp.d + 1)::timestamp AT TIME ZONE 'Asia/Tashkent')
            AND ${platformOf(src2)} = sp.pl
            AND lower(${sessionCampaign('s2')}) = sp.c) AS total
        FROM sp)
      SELECT (SELECT SUM(spend * n / NULLIF(total, 0)) FROM tot) AS cac,
             (SELECT count(*) FROM mine) AS paid`;
    if (!num(row?.paid)) return null;
    return soum(row?.cac);
  }

  async order(number: string): Promise<OrderJourneyDto> {
    const [order] = await this.prisma.$queryRaw<
      {
        number: string;
        attribution: unknown;
        purchase: boolean;
        revenue: unknown;
        sessionId: string | null;
        hasReplay: boolean | null;
      }[]
    >`
      SELECT o.number, o.attribution, ${isPurchase('o')} AS purchase, ${revenueOf('o')} AS revenue,
             s.id AS "sessionId", s."hasReplay"
      FROM "Order" o LEFT JOIN "Session" s ON s.id = o."sessionId"
      WHERE o.number = ${number}`;
    if (!order) throw new DomainError('ORDER_NOT_FOUND');
    const attribution = parseOrderAttribution(order.attribution);
    // Split whole so'm so the shown parts add up to the shown total.
    const revenueSoum = BigInt(soum(order.revenue));
    const perModel = Object.fromEntries(
      ATTRIBUTION_MODELS.map((m) => [
        m,
        attribution
          ? allocateByShares(
              revenueSoum,
              attribution.touches.map((x) => x.shares[m]),
            )
          : [],
      ]),
    ) as Record<(typeof ATTRIBUTION_MODELS)[number], bigint[]>;
    return {
      number: order.number,
      state: attribution ? 'attributed' : order.purchase ? 'pending' : 'not_purchase',
      revenueSoum: Number(revenueSoum),
      computedAt: attribution?.computedAt ?? null,
      touches: (attribution?.touches ?? []).map((x, i) => ({
        ...touchDto(x),
        sessionId: x.sessionId ?? null,
        shares: x.shares,
        revenueSoum: {
          first_touch: Number(perModel.first_touch[i]),
          last_non_direct: Number(perModel.last_non_direct[i]),
          linear: Number(perModel.linear[i]),
        },
      })),
      purchaseSession: order.sessionId
        ? { id: order.sessionId, hasReplay: order.hasReplay === true }
        : null,
    };
  }
}
