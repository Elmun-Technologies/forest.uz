import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  AUDIENCE_PRESET_KEYS,
  type AudienceCondition,
  audienceRulesSchema,
} from '@forest/contracts';
import {
  audiencePresets,
  PRODUCT_SLUG_PREFIX,
} from '../../../../packages/db/src/seed/data/audiences';
import { compileAudience, conditionSql, pathSql, previewSql } from './compile';
import { Prisma } from '@forest/db';

const NOW = new Date('2026-10-27T10:00:00.000Z');
const DAY = 86_400_000;
const rules = (...conditions: AudienceCondition[]) =>
  audienceRulesSchema.parse({ groups: [{ conditions }] });

/** Every condition type with values a user could type, incl. SQL meta characters. */
const ALL: AudienceCondition[] = [
  {
    type: 'event',
    event: 'add_to_cart',
    did: true,
    withinDays: 7,
    path: { op: 'prefix', value: "/p/x'; DROP" },
  },
  { type: 'event', event: 'view_item', did: false, withinDays: 3 },
  { type: 'event', event: 'purchase', did: false, withinDays: 7 },
  {
    type: 'page_time',
    path: { op: 'equals', value: '/p/divan' },
    minSeconds: 30,
    withinDays: 30,
    did: true,
  },
  {
    type: 'page_time',
    path: { op: 'equals', value: '/p/divan' },
    minSeconds: 30,
    withinDays: 30,
    did: false,
  },
  { type: 'orders', metric: 'count', op: 'gte', value: 2 },
  { type: 'orders', metric: 'sum', op: 'lte', value: 2_000_000, withinDays: 90 },
  { type: 'last_order', op: 'within', days: 10 },
  { type: 'last_order', op: 'older', days: 60 },
  { type: 'product', productId: "p1' OR 1=1 --", bought: true, olderThanDays: 21 },
  { type: 'product', productId: 'p2', bought: false, withinDays: 30 },
  { type: 'consent', channel: 'ads', granted: true },
  { type: 'tag', tag: "vip'%_", has: false },
  { type: 'region', regions: ['tashkent_city', 'samarkand'], include: true },
  { type: 'device', device: 'mobile' },
  { type: 'lead', has: true, source: 'popup' },
];

describe('audience compiler', () => {
  it('compiles every condition type to parameterised SQL (no user value in the text)', () => {
    for (const cond of ALL) {
      const sql = conditionSql(cond, NOW);
      for (const v of ["x'; DROP", "p1' OR 1=1", "vip'%_", 'popup', 'tashkent_city', 'mobile'])
        expect(sql.sql, `${cond.type} leaks ${v}`).not.toContain(v);
      expect(sql.sql).not.toMatch(/\$\{/);
    }
  });

  it('ANDs conditions inside a group and ORs groups, live customers only', () => {
    const q = compileAudience(
      audienceRulesSchema.parse({
        groups: [{ conditions: [ALL[5]!, ALL[11]!] }, { conditions: [ALL[15]!] }],
      }),
      NOW,
    );
    expect(q.sql).toMatch(/^SELECT c\.id FROM "Customer" c\s+WHERE c\."deletedAt" IS NULL AND \(/);
    expect(q.sql).toContain(') OR (');
    expect(q.sql).toContain(') AND (');
  });

  it('event conditions bound the time window with the clock passed in', () => {
    const q = conditionSql({ type: 'event', event: 'add_to_cart', did: true, withinDays: 7 }, NOW);
    expect(q.values).toContainEqual(new Date(NOW.getTime() - 7 * DAY));
    expect(q.values).toContainEqual(NOW);
    expect(q.values).toContain('add_to_cart');
    expect(q.sql).toContain('"Event" e');
  });

  it('a purchase event reads orders (the analytics purchase predicate), not Event rows', () => {
    const q = conditionSql({ type: 'event', event: 'purchase', did: false, withinDays: 7 }, NOW);
    expect(q.sql).toMatch(/^NOT EXISTS \(SELECT 1 FROM "Order" o/);
    expect(q.sql).not.toContain('"Event"');
    expect(q.sql).toContain("'PAID', 'PARTIALLY_REFUNDED'");
  });

  it('order sums compare in tiyin', () => {
    const q = conditionSql({ type: 'orders', metric: 'sum', op: 'gte', value: 2_000_000 }, NOW);
    expect(q.values).toContain(200_000_000n);
  });

  it('paths match with and without the locale prefix', () => {
    const eq = pathSql(Prisma.sql`e.path`, { op: 'equals', value: '/p/divan' });
    expect(eq.values).toEqual(['/p/divan', '/uz/p/divan', '/ru/p/divan']);
    const prefix = pathSql(Prisma.sql`e.path`, { op: 'prefix', value: '/p/a_b' });
    expect(prefix.values).toEqual(['/p/a\\_b%', '/uz/p/a\\_b%', '/ru/p/a\\_b%']);
    const root = pathSql(Prisma.sql`e.path`, { op: 'equals', value: '/' });
    expect(root.values).toEqual(['/', '/uz', '/ru', '/uz/', '/ru/']);
  });

  it('consent is the latest row per channel (enum literal is a cast parameter)', () => {
    const q = conditionSql({ type: 'consent', channel: 'sms', granted: false }, NOW);
    expect(q.values).toEqual(['SMS_MARKETING', false]);
    expect(q.sql).toContain('ORDER BY cs."createdAt" DESC, cs.id DESC LIMIT 1');
  });

  it('upsell product condition: bought at least N days ago', () => {
    const q = conditionSql(
      { type: 'product', productId: 'p', bought: true, olderThanDays: 21 },
      NOW,
    );
    expect(q.values).toContainEqual(new Date(NOW.getTime() - 21 * DAY));
    expect(q.sql).toContain('o."createdAt" <=');
  });

  it('preview wraps the same member query', () => {
    const r = rules(ALL[5]!);
    expect(previewSql(r, NOW).sql).toContain(compileAudience(r, NOW).sql);
  });
});

describe('preset segments', () => {
  const MIGRATION = path.resolve(
    __dirname,
    '../../../../packages/db/prisma/migrations/20261027153000_audiences/migration.sql',
  );

  it('every preset parses with the rule schema (product slugs stand in for ids)', () => {
    for (const p of audiencePresets)
      expect(audienceRulesSchema.safeParse(p.rules).success, p.key).toBe(true);
    expect(audiencePresets.map((p) => p.key)).toEqual([...AUDIENCE_PRESET_KEYS]);
  });

  it('the migration inserts exactly the seed presets', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const lit = "'((?:[^']|'')*)'";
    const row = new RegExp(
      `SELECT 'seg_([a-z0-9_]+)', ${lit}, ${lit}, ${lit}, (?:replace\\()*${lit}`,
      'g',
    );
    const un = (s: string) => s.replace(/''/g, "'");
    const rows = [...sql.matchAll(row)].map((m) => ({
      key: un(m[2]!),
      name: un(m[3]!),
      description: un(m[4]!),
      rules: JSON.parse(un(m[5]!)) as unknown,
    }));
    expect(rows).toEqual(
      audiencePresets.map((p) => ({
        key: p.key,
        name: p.name,
        description: p.description,
        rules: p.rules,
      })),
    );
    // Every slug placeholder is resolved by the INSERT (else a preset would store "slug:…").
    for (const p of audiencePresets)
      for (const g of p.rules.groups)
        for (const c of g.conditions)
          if (typeof c.productId === 'string')
            expect(sql).toContain(`'"${c.productId}"', to_jsonb(`);
    expect(PRODUCT_SLUG_PREFIX).toBe('slug:');
  });
});
