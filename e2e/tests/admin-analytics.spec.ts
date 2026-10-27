import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { ownerContext } from './admin-helpers';

/**
 * Phase 4 acceptance (docs/12): traffic → dashboard numbers equal DB truth. Traffic comes from the
 * synthetic generator (`e2e/synthetic/traffic.ts`, agent 1) when present, else from a small local
 * seed written straight into the DB. Truth is computed here with its own SQL (psql), written from
 * the CLAUDE.md §6 definitions — not the API's queries.
 */
test.describe.configure({ mode: 'serial' });

function databaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
    return env.match(/^DATABASE_URL=([^#\n]*)/m)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

const DB = databaseUrl();
const hasPsql = (() => {
  try {
    execFileSync('psql', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

function sql(query: string): string[][] {
  const out = execFileSync(
    'psql',
    [DB!, '-AtqX', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', query],
    {
      encoding: 'utf8',
    },
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));
}

const run = `e2e${Date.now().toString(36)}`;
/** Period start (7 Tashkent days ending today), as SQL. */
const FROM = `((date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') - interval '6 days') AT TIME ZONE 'Asia/Tashkent')`;
const TO = `((date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') + interval '1 day') AT TIME ZONE 'Asia/Tashkent')`;
const PURCHASE = `o.status NOT IN ('CANCELLED','RETURNED') AND (
  EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.status IN ('PAID','PARTIALLY_REFUNDED'))
  OR (o."paymentMethod" = 'COD' AND o.status IN ('CONFIRMED','PACKING','READY','HANDED_TO_COURIER','DELIVERED','COMPLETED','RETURN_REQUESTED')))`;

interface Truth {
  sessions: number;
  visitors: number;
  orders: number;
  revenueSoum: number;
  leads: number;
  funnel: number[];
}

function truth(): Truth {
  const [row] = sql(`
    WITH ss AS (SELECT * FROM "Session" WHERE "startedAt" >= ${FROM} AND "startedAt" < ${TO}),
    pu AS (SELECT o.id, o."sessionId", o."totalTiyin" - COALESCE((SELECT SUM(r."amountTiyin")
             FROM "Refund" r JOIN "Payment" p ON p.id = r."paymentId" WHERE p."orderId" = o.id), 0) AS rev
           FROM "Order" o WHERE o."createdAt" >= ${FROM} AND o."createdAt" < ${TO} AND ${PURCHASE}),
    ev AS (SELECT name, "sessionId" FROM "Event" WHERE ts >= ${FROM} AND ts < ${TO}
             AND name IN ('view_item','add_to_cart','begin_checkout')
             AND "sessionId" IN (SELECT id FROM ss))
    SELECT (SELECT count(*) FROM ss), (SELECT count(DISTINCT "anonymousId") FROM ss),
           (SELECT count(*) FROM pu), (SELECT round(COALESCE(SUM(rev), 0) / 100.0) FROM pu),
           (SELECT count(*) FROM "Customer" WHERE "leadAt" >= ${FROM} AND "leadAt" < ${TO}),
           (SELECT count(DISTINCT "sessionId") FROM ev WHERE name = 'view_item'),
           (SELECT count(DISTINCT "sessionId") FROM ev WHERE name = 'add_to_cart'),
           (SELECT count(DISTINCT "sessionId") FROM ev WHERE name = 'begin_checkout'),
           (SELECT count(*) FROM ss WHERE EXISTS (SELECT 1 FROM "Order" o
              WHERE o."sessionId" = ss.id AND ${PURCHASE}))`);
  const n = row!.map(Number);
  return {
    sessions: n[0]!,
    visitors: n[1]!,
    orders: n[2]!,
    revenueSoum: n[3]!,
    leads: n[4]!,
    funnel: [n[0]!, n[5]!, n[6]!, n[7]!, n[8]!],
  };
}

/** Small known traffic for today (Tashkent): 3 sessions of 2 visitors, 1 paid order. */
function localSeed(): void {
  const s = [`${run}-s1`, `${run}-s2`, `${run}-s3`];
  sql(`
    INSERT INTO "Session" (id, "anonymousId", "startedAt", "endedAt", "landingPath", channel, device, pageviews, bounced, utm)
    VALUES ('${s[0]}', '${run}-a1', now() - interval '20 minutes', now() - interval '18 minutes', '/uz', 'paid_meta', 'mobile', 2, false,
            '{"source":"instagram","medium":"cpc","campaign":"${run}"}'),
           ('${s[1]}', '${run}-a1', now() - interval '10 minutes', now() - interval '5 minutes', '/uz/katalog', 'direct', 'mobile', 3, false, NULL),
           ('${s[2]}', '${run}-a2', now() - interval '9 minutes', now() - interval '9 minutes', '/uz', 'organic_search', 'desktop', 1, true, NULL);
    INSERT INTO "Event" (id, ts, "sessionId", "anonymousId", name, path) VALUES
      (gen_random_uuid()::text, now() - interval '19 minutes', '${s[0]}', '${run}-a1', 'view_item', '/uz/p/x'),
      (gen_random_uuid()::text, now() - interval '9 minutes', '${s[1]}', '${run}-a1', 'view_item', '/uz/p/x'),
      (gen_random_uuid()::text, now() - interval '8 minutes', '${s[1]}', '${run}-a1', 'add_to_cart', '/uz/p/x'),
      (gen_random_uuid()::text, now() - interval '7 minutes', '${s[1]}', '${run}-a1', 'begin_checkout', '/uz/checkout');
    INSERT INTO "Customer" (id, name, "leadAt", "leadSource", "updatedAt")
      VALUES ('${run}-c1', '${run}', now() - interval '6 minutes', 'checkout', now());
    INSERT INTO "Order" (id, "publicId", "trackingToken", "customerId", status, "contactName", "contactPhone", address,
      "subtotalTiyin", "totalTiyin", "paymentMethod", "deliveryZone", carrier, "offerVersion", "sessionId", "anonymousId", "updatedAt")
      VALUES ('${run}-o1', '${run}-p', '${run}-t', '${run}-c1', 'CONFIRMED', 'E2E', '+998900000000', '{"region":"tashkent_city"}',
        12300000, 12300000, 'PAYME', 'tashkent-city-yandex', 'YANDEX', 'e2e', '${s[1]}', '${run}-a1', now());
    INSERT INTO "Payment" (id, "orderId", method, status, "amountTiyin", "updatedAt")
      VALUES ('${run}-pay', '${run}-o1', 'PAYME', 'PAID', 12300000, now());`);
}

function cleanup(): void {
  sql(`
    DELETE FROM "Payment" WHERE "orderId" = '${run}-o1';
    DELETE FROM "Order" WHERE id = '${run}-o1';
    DELETE FROM "Customer" WHERE id = '${run}-c1';
    DELETE FROM "Event" WHERE "sessionId" LIKE '${run}-%' AND ts >= now() - interval '2 hours';
    DELETE FROM "Session" WHERE id LIKE '${run}-%';`);
}

/**
 * Hook for agent 1's generator: any of `runSyntheticTraffic`, `generateTraffic` or the default
 * export, called with `{ browser }`. Returns false when the file isn't there yet.
 */
async function synthetic(browser: Browser): Promise<boolean> {
  const file = path.resolve(__dirname, '../synthetic/traffic.ts');
  if (!existsSync(file)) return false;
  const mod = (await import(file)) as Record<string, unknown>;
  const fn = (mod.runSyntheticTraffic ?? mod.generateTraffic ?? mod.default) as
    ((o: { browser: Browser }) => Promise<unknown>) | undefined;
  if (typeof fn !== 'function') return false;
  await fn({ browser });
  return true;
}

const digits = (s: string | null) => Number((s ?? '').replace(/[^\d]/g, '') || 'NaN');

/** Raw KPI value the dashboard rendered (`data-value`; the tile text is formatted). */
async function kpi(page: Page, id: string): Promise<number> {
  return Number(await page.getByTestId(`kpi-${id}`).getAttribute('data-value'));
}

test.describe('A1 dashboard = DB truth', () => {
  test.skip(!DB || !hasPsql, 'needs DATABASE_URL and psql');
  let seeded = false;

  test.beforeAll(async ({ browser }) => {
    if (!(await synthetic(browser))) {
      localSeed();
      seeded = true;
    }
  });

  test.afterAll(() => {
    if (seeded) cleanup();
  });

  test('KPIs and funnel for 7 days match SQL', async ({ browser }) => {
    const { ctx, page } = await ownerContext(browser);
    // Other suites may write traffic meanwhile: accept a render only when the truth was stable
    // around it.
    await expect(async () => {
      const before = truth();
      await page.goto('/?days=7');
      await expect(page.getByTestId('kpis')).toBeVisible();
      const shown = {
        sessions: await kpi(page, 'sessions'),
        visitors: await kpi(page, 'visitors'),
        orders: await kpi(page, 'orders'),
        revenueSoum: await kpi(page, 'revenue'),
        leads: await kpi(page, 'leads'),
        funnel: await Promise.all(
          ['visit', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase'].map(async (s) =>
            digits(await page.getByTestId(`funnel-${s}`).textContent()),
          ),
        ),
      };
      const after = truth();
      expect(after).toEqual(before);
      expect(shown).toEqual({
        sessions: after.sessions,
        visitors: after.visitors,
        orders: after.orders,
        revenueSoum: after.revenueSoum,
        leads: after.leads,
        funnel: after.funnel,
      });
      expect(after.sessions).toBeGreaterThanOrEqual(seeded ? 3 : 1);
    }).toPass({ timeout: 60_000, intervals: [1_000, 3_000, 5_000] });
    await ctx.close();
  });

  test('A2 sources totals match SQL', async ({ browser }) => {
    const { ctx, page } = await ownerContext(browser);
    await expect(async () => {
      const before = truth();
      await page.goto('/analytics?tab=sources&days=7');
      const totals = page.getByTestId('source-totals');
      await expect(totals).toBeVisible();
      const tile = async (i: number) =>
        digits(await totals.locator(':scope > div').nth(i).locator('span').nth(1).textContent());
      const shown = { sessions: await tile(0), orders: await tile(2) };
      const after = truth();
      expect(after).toEqual(before);
      expect(shown).toEqual({ sessions: after.sessions, orders: after.orders });
    }).toPass({ timeout: 60_000, intervals: [1_000, 3_000, 5_000] });
    await ctx.close();
  });
});
