import { Injectable } from '@nestjs/common';
import {
  type AdminPromoDto,
  type AdminPromoListQuery,
  type AdminPromoPageDto,
  type AdminPromoStatsDto,
  type AdminPromoSummaryDto,
  DomainError,
  percentOf,
  type PromoCreateInput,
  promoState,
  type PromoUpdateInput,
  soumToTiyin,
  tiyinToSoumInt,
} from '@forest/contracts';
import { Prisma, type PromoCode } from '@forest/db';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { decodeCursor, encodeCursor } from '../products/cursor';
import { localized } from '../products/product-text';

type Tx = Prisma.TransactionClient;

const PERIOD_DAYS = 30;
const DAY_MS = 86_400_000;

/** The stored row shape the rules look at (create input and merged updates alike). */
interface PromoShape {
  code: string;
  type: PromoCode['type'];
  value: number;
  giftVariantId: string | null;
  minCartTiyin: bigint;
  audience: PromoCode['audience'];
  segmentId: string | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  startsAt: Date | null;
  endsAt: Date | null;
  utmSource: string | null;
  active: boolean;
}

interface StatsRow {
  promoId: string;
  uses: bigint;
  discount: bigint | null;
  revenue: bigint | null;
  suspicious: bigint;
}

/**
 * A14 promo codes: CRUD with the docs/02 rules enforced on save (margin guard against
 * `promo.rules.maxDiscountPct`, so `priceCart` never has to silently cap a code), stats per code
 * and KPIs from `PromoRedemption`. Redemptions of cancelled orders don't count (like
 * `PromoService`).
 */
@Injectable()
export class AdminPromoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async summary(): Promise<AdminPromoSummaryDto> {
    const since = new Date(Date.now() - PERIOD_DAYS * DAY_MS);
    const [rules, zones, kits, orders, coded, suspicious, giftOptions, segments] =
      await Promise.all([
        this.settings.get('promo.rules'),
        this.settings.get('delivery.zones'),
        this.prisma.product.findMany({
          where: { type: 'BUNDLE', status: 'ACTIVE' },
          include: { variants: { where: { active: true }, orderBy: { sort: 'asc' }, take: 1 } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.order.count({
          where: { createdAt: { gte: since }, status: { not: 'CANCELLED' } },
        }),
        this.prisma.$queryRaw<{ n: bigint; discount: bigint | null; revenue: bigint | null }[]>`
          SELECT COUNT(*)::bigint AS n, SUM(r."discountTiyin")::bigint AS discount,
                 SUM(o."totalTiyin")::bigint AS revenue
          FROM "PromoRedemption" r JOIN "Order" o ON o."id" = r."orderId"
          WHERE o."createdAt" >= ${since} AND o."status" <> 'CANCELLED'`,
        this.suspiciousCount(since),
        this.prisma.variant.findMany({
          where: { active: true, product: { status: 'ACTIVE' } },
          include: { product: { select: { name: true } } },
          orderBy: [{ productId: 'asc' }, { sort: 'asc' }],
        }),
        this.prisma.segment.findMany({ where: { active: true }, select: { id: true, name: true } }),
      ]);
    const c = coded[0];
    return {
      periodDays: PERIOD_DAYS,
      kpis: {
        ordersWithCodePct: orders > 0 ? Math.round((Number(c?.n ?? 0n) / orders) * 100) : null,
        discountSoum: tiyinToSoumInt(c?.discount ?? 0n),
        revenueSoum: tiyinToSoumInt(c?.revenue ?? 0n),
        suspicious,
      },
      rules: { maxDiscountPct: rules.maxDiscountPct },
      automatic: {
        freeShipping: zones
          .filter((z) => z.active)
          .sort((a, b) => a.sort - b.sort)
          .map((z) => ({ zone: localized(z.name), freeFromSoum: z.freeFromSoum })),
        kits: kits.flatMap((k) => {
          const v = k.variants[0];
          if (!v) return [];
          const saving =
            v.compareAtTiyin && v.compareAtTiyin > v.priceTiyin
              ? Math.round(
                  Number(((v.compareAtTiyin - v.priceTiyin) * 1000n) / v.compareAtTiyin) / 10,
                )
              : 0;
          return [
            {
              productId: k.id,
              name: localized(k.name),
              priceSoum: tiyinToSoumInt(v.priceTiyin),
              savingPct: saving,
            },
          ];
        }),
        secondPurchaseGift: { enabled: false },
      },
      giftOptions: giftOptions.map((v) => ({
        variantId: v.id,
        label: `${localized(v.product.name).uz} · ${localized(v.label).uz}`,
        priceSoum: tiyinToSoumInt(v.priceTiyin),
      })),
      segments,
    };
  }

  async list(q: AdminPromoListQuery): Promise<AdminPromoPageDto> {
    const rows = await this.prisma.promoCode.findMany({
      where: q.q ? { code: { contains: q.q.trim().toUpperCase() } } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const dtos = await this.toDtos(rows);
    let filtered = q.state ? dtos.filter((d) => d.state === q.state) : dtos;
    // Codes are few (tens): stats need every row anyway, so the keyset is applied in memory.
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      filtered = filtered.filter((d) => {
        const at = new Date(d.createdAt);
        return at < c.createdAt || (at.getTime() === c.createdAt.getTime() && d.id < c.id);
      });
    }
    const page = filtered.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        filtered.length > q.limit && last ? encodeCursor(new Date(last.createdAt), last.id) : null,
    };
  }

  async get(id: string): Promise<AdminPromoDto> {
    const row = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!row) throw new DomainError('NOT_FOUND');
    const [dto] = await this.toDtos([row]);
    return dto!;
  }

  async create(actor: AuditActor, input: PromoCreateInput): Promise<AdminPromoDto> {
    const shape = normalize({
      ...input,
      minCartTiyin: soumToTiyin(input.minCartSoum),
    });
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await this.assertRules(tx, shape);
        const created = await tx.promoCode.create({ data: shape });
        await this.audit.record(
          actor,
          {
            action: 'promo.create',
            entity: 'PromoCode',
            entityId: created.id,
            after: auditView(shape),
          },
          tx,
        );
        return created.id;
      });
      return this.get(id);
    } catch (e) {
      throw mapCodeTaken(e);
    }
  }

  async update(actor: AuditActor, id: string, input: PromoUpdateInput): Promise<AdminPromoDto> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "PromoCode" WHERE "id" = ${id} FOR UPDATE`;
        const before = await tx.promoCode.findUnique({ where: { id } });
        if (!before) throw new DomainError('NOT_FOUND');
        const { minCartSoum, ...rest } = input;
        const merged = normalize({
          ...pick(before),
          ...rest,
          ...(minCartSoum !== undefined ? { minCartTiyin: soumToTiyin(minCartSoum) } : {}),
        });
        if (merged.code !== before.code) {
          const used = await tx.promoRedemption.count({ where: { promoId: id } });
          if (used > 0) throw new DomainError('PROMO_CODE_LOCKED', undefined, 'code');
        }
        await this.assertRules(tx, merged);
        await tx.promoCode.update({ where: { id }, data: merged });
        const prev = auditView(pick(before));
        const next = auditView(merged);
        const keys = (Object.keys(next) as (keyof typeof next)[]).filter(
          (k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]),
        );
        await this.audit.record(
          actor,
          {
            action: 'promo.update',
            entity: 'PromoCode',
            entityId: id,
            before: Object.fromEntries(keys.map((k) => [k, prev[k]])),
            after: Object.fromEntries(keys.map((k) => [k, next[k]])),
          },
          tx,
        );
      });
    } catch (e) {
      throw mapCodeTaken(e);
    }
    return this.get(id);
  }

  // ───────── rules ─────────

  /** docs/02 A14 rules that need settings or other rows. */
  private async assertRules(tx: Tx, p: PromoShape): Promise<void> {
    const { maxDiscountPct } = await this.settings.get('promo.rules');
    if (p.startsAt && p.endsAt && p.endsAt <= p.startsAt)
      throw new DomainError('PROMO_DATES_INVALID', undefined, 'endsAt');
    const guard = { max: String(maxDiscountPct) };
    const capOfMinCart = percentOf(p.minCartTiyin, maxDiscountPct);
    switch (p.type) {
      case 'PERCENT':
        if (p.value < 1) throw new DomainError('VALIDATION_FAILED', undefined, 'value');
        if (p.value > maxDiscountPct)
          throw new DomainError('PROMO_OVER_MARGIN_GUARD', guard, 'value');
        break;
      case 'FIXED':
        if (p.value < 1) throw new DomainError('VALIDATION_FAILED', undefined, 'value');
        if (soumToTiyin(p.value) > capOfMinCart)
          throw new DomainError('PROMO_OVER_MARGIN_GUARD', guard, 'minCartSoum');
        break;
      case 'GIFT': {
        const v = p.giftVariantId
          ? await tx.variant.findUnique({
              where: { id: p.giftVariantId },
              select: { active: true, priceTiyin: true, product: { select: { status: true } } },
            })
          : null;
        // A gift must be sellable: an inactive variant or a DRAFT/ARCHIVED product never ships.
        if (!v || !v.active || v.product.status !== 'ACTIVE')
          throw new DomainError('PROMO_GIFT_INVALID', undefined, 'giftVariantId');
        if (v.priceTiyin > capOfMinCart)
          throw new DomainError('PROMO_OVER_MARGIN_GUARD', guard, 'minCartSoum');
        break;
      }
      case 'FREE_SHIPPING':
        break;
    }
    if (p.audience === 'SEGMENT') {
      const seg = p.segmentId ? await tx.segment.count({ where: { id: p.segmentId } }) : 0;
      if (!seg) throw new DomainError('VALIDATION_FAILED', undefined, 'segmentId');
    }
  }

  // ───────── stats ─────────

  private async toDtos(rows: PromoCode[]): Promise<AdminPromoDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [stats, everUsed, gifts] = await Promise.all([
      this.stats(ids),
      this.prisma.promoRedemption.groupBy({
        by: ['promoId'],
        where: { promoId: { in: ids } },
        _count: true,
      }),
      this.prisma.variant.findMany({
        where: { id: { in: rows.flatMap((r) => (r.giftVariantId ? [r.giftVariantId] : [])) } },
        include: { product: { select: { name: true } } },
      }),
    ]);
    const used = new Set(everUsed.map((u) => u.promoId));
    const giftById = new Map(gifts.map((g) => [g.id, g]));
    const now = new Date();
    return rows.map((r) => {
      const s = stats.get(r.id) ?? { uses: 0, discountSoum: 0, revenueSoum: 0, suspicious: 0 };
      const g = r.giftVariantId ? giftById.get(r.giftVariantId) : undefined;
      return {
        id: r.id,
        code: r.code,
        type: r.type,
        value: r.value,
        gift: g
          ? {
              variantId: g.id,
              sku: g.sku,
              label: localized(g.label).uz,
              productName: localized(g.product.name).uz,
              priceSoum: tiyinToSoumInt(g.priceTiyin),
            }
          : null,
        minCartSoum: tiyinToSoumInt(r.minCartTiyin),
        audience: r.audience,
        segmentId: r.segmentId,
        usageLimit: r.usageLimit,
        perCustomerLimit: r.perCustomerLimit,
        startsAt: r.startsAt?.toISOString() ?? null,
        endsAt: r.endsAt?.toISOString() ?? null,
        utmSource: r.utmSource,
        active: r.active,
        state: promoState(r, s.uses, now),
        locked: used.has(r.id),
        createdAt: r.createdAt.toISOString(),
        stats: s,
      };
    });
  }

  private async stats(ids: string[]): Promise<Map<string, AdminPromoStatsDto>> {
    const rows = await this.prisma.$queryRaw<StatsRow[]>`
      SELECT r."promoId" AS "promoId",
             COUNT(*)::bigint AS uses,
             SUM(r."discountTiyin")::bigint AS discount,
             SUM(o."totalTiyin")::bigint AS revenue,
             COUNT(*) FILTER (WHERE ${suspiciousSql})::bigint AS suspicious
      FROM "PromoRedemption" r JOIN "Order" o ON o."id" = r."orderId"
      WHERE r."promoId" IN (${Prisma.join(ids)}) AND o."status" <> 'CANCELLED'
      GROUP BY r."promoId"`;
    return new Map(
      rows.map((r) => [
        r.promoId,
        {
          uses: Number(r.uses),
          discountSoum: tiyinToSoumInt(r.discount ?? 0n),
          revenueSoum: tiyinToSoumInt(r.revenue ?? 0n),
          suspicious: Number(r.suspicious),
        },
      ]),
    );
  }

  private async suspiciousCount(since: Date): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n
      FROM "PromoRedemption" r JOIN "Order" o ON o."id" = r."orderId"
      WHERE r."createdAt" >= ${since} AND o."status" <> 'CANCELLED' AND ${suspiciousSql}`;
    return Number(row?.n ?? 0n);
  }
}

/**
 * docs/02 "Shubhali": flagged at checkout, or the same device used the same code for another
 * customer (one phone AND one device per code).
 */
const suspiciousSql = Prisma.sql`(r."suspicious" OR EXISTS (
  SELECT 1 FROM "PromoRedemption" r2 JOIN "Order" o2 ON o2."id" = r2."orderId"
  WHERE r2."promoId" = r."promoId" AND r2."deviceHash" = r."deviceHash"
    AND r2."customerId" <> r."customerId" AND o2."status" <> 'CANCELLED'))`;

function pick(r: PromoCode): PromoShape {
  return {
    code: r.code,
    type: r.type,
    value: r.value,
    giftVariantId: r.giftVariantId,
    minCartTiyin: r.minCartTiyin,
    audience: r.audience,
    segmentId: r.segmentId,
    usageLimit: r.usageLimit,
    perCustomerLimit: r.perCustomerLimit,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    utmSource: r.utmSource,
    active: r.active,
  };
}

/** Type-dependent fields cleared; first-order codes are one per customer (docs/02). */
function normalize(p: PromoShape & Record<string, unknown>): PromoShape {
  const shape = pick(p as unknown as PromoCode);
  return {
    ...shape,
    value: shape.type === 'FREE_SHIPPING' || shape.type === 'GIFT' ? 0 : shape.value,
    giftVariantId: shape.type === 'GIFT' ? shape.giftVariantId : null,
    segmentId: shape.audience === 'SEGMENT' ? shape.segmentId : null,
    perCustomerLimit: shape.audience === 'FIRST_ORDER' ? 1 : shape.perCustomerLimit,
  };
}

function auditView({ minCartTiyin, ...p }: PromoShape) {
  return { ...p, minCartSoum: tiyinToSoumInt(minCartTiyin) };
}

function mapCodeTaken(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
    return new DomainError('PROMO_CODE_TAKEN', undefined, 'code');
  return e;
}
