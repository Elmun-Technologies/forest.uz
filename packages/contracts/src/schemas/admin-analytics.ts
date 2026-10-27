import { z } from 'zod';
import {
  AD_PLATFORMS,
  type AdPlatform,
  adPlatformOfSource,
  ANALYTICS_DEVICES,
  ANALYTICS_PERIODS,
  DASHBOARD_PERIODS,
} from '../admin-analytics';
import { ATTRIBUTION_MODELS, DEFAULT_ATTRIBUTION_MODEL } from '../attribution';

/** Admin A1/A2 inputs (`/v1/admin/analytics`). DTOs live in the zod-free `admin-analytics.ts`. */

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const periodDays = <T extends readonly number[]>(allowed: T, fallback: T[number]) =>
  z.coerce
    .number()
    .int()
    .refine((n) => (allowed as readonly number[]).includes(n))
    .catch(fallback)
    .default(fallback);

export const dashboardQuerySchema = z.object({
  days: periodDays(DASHBOARD_PERIODS, 30),
  end: z.preprocess(blankToUndefined, dayKey.optional()),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const analyticsQuerySchema = z.object({
  days: periodDays(ANALYTICS_PERIODS, 30),
  /** Last day of the period (Tashkent `YYYY-MM-DD`); default today. */
  end: z.preprocess(blankToUndefined, dayKey.optional()),
  device: z.preprocess(blankToUndefined, z.enum(ANALYTICS_DEVICES).optional()).catch(undefined),
  channel: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(64)
      .regex(/^[\w.-]+$/)
      .optional(),
  ),
  compare: z
    .preprocess(
      (v) => (v === undefined ? true : v === '1' || v === 'true' || v === true),
      z.boolean(),
    )
    .default(true),
  model: z
    .enum(ATTRIBUTION_MODELS)
    .catch(DEFAULT_ATTRIBUTION_MODEL)
    .default(DEFAULT_ATTRIBUTION_MODEL),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const adSpendSummaryQuerySchema = z.object({
  days: periodDays(ANALYTICS_PERIODS, 30),
  end: z.preprocess(blankToUndefined, dayKey.optional()),
});
export type AdSpendSummaryQuery = z.infer<typeof adSpendSummaryQuerySchema>;

/** ≤ 2 MB of CSV text (the admin reads the file and posts its text). */
export const AD_SPEND_CSV_MAX_CHARS = 2_000_000;
export const AD_SPEND_CSV_MAX_ROWS = 10_000;

export const adSpendImportSchema = z.object({
  csv: z.string().min(1).max(AD_SPEND_CSV_MAX_CHARS),
});
export type AdSpendImportInput = z.infer<typeof adSpendImportSchema>;

export const adSpendSyncSchema = z
  .object({
    platform: z.enum(AD_PLATFORMS as [AdPlatform, ...AdPlatform[]]),
    from: dayKey,
    to: dayKey,
  })
  .refine((v) => v.from <= v.to, { path: ['to'] });
export type AdSpendSyncInput = z.infer<typeof adSpendSyncSchema>;

// ───────────────────────── CSV ─────────────────────────

export interface AdSpendRow {
  /** Tashkent day `YYYY-MM-DD`. */
  date: string;
  platform: AdPlatform;
  campaignId: string;
  campaign: string;
  adset: string | null;
  spendTiyin: bigint;
  impressions: number;
  clicks: number;
}

export interface AdSpendCsvError {
  line: number;
  message: string;
}

/** Minimal RFC 4180 reader (quoted fields, doubled quotes, CRLF) for one delimiter. */
function readCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  date: 'date',
  day: 'date',
  platform: 'platform',
  campaign_id: 'campaign_id',
  campaignid: 'campaign_id',
  campaign: 'campaign',
  campaign_name: 'campaign',
  adset: 'adset',
  ad_set: 'adset',
  spend: 'spend',
  cost: 'spend',
  impressions: 'impressions',
  clicks: 'clicks',
};

function parseDay(raw: string): string | null {
  const v = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const dmy = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
}

/** So'm with ≤ 2 decimals ("18 200 000", "182000.50"; "182000,50" in `;` files) → tiyin. */
function parseSoum(raw: string, decimalComma: boolean): bigint | null {
  let v = raw.replace(/[\s\u00A0\u202F]/g, '');
  if (decimalComma) v = v.replace(',', '.');
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
}

function parseCount(raw: string): number | null {
  const v = raw.replace(/[\s\u00A0\u202F]/g, '');
  if (v === '') return 0;
  return /^\d{1,10}$/.test(v) && Number(v) <= 2_147_483_647 ? Number(v) : null;
}

/**
 * Ad spend CSV (`date,platform,campaign_id,campaign,adset,spend,impressions,clicks`; `,` or `;`
 * separated, header row required, any column order). All-or-nothing: any error → no rows.
 * `platform` accepts the platform key or a utm source of it (facebook → meta).
 */
export function parseAdSpendCsv(text: string): { rows: AdSpendRow[]; errors: AdSpendCsvError[] } {
  const body = text.replace(/^\uFEFF/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const table = readCsv(body, delimiter).filter((r) => r.some((c) => c.trim() !== ''));
  const errors: AdSpendCsvError[] = [];
  const header = (table[0] ?? []).map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? '');
  const col = (name: string) => header.indexOf(name);
  for (const required of ['date', 'platform', 'campaign_id', 'spend'])
    if (col(required) < 0) errors.push({ line: 1, message: `"${required}" ustuni yo'q` });
  if (errors.length) return { rows: [], errors };
  if (table.length - 1 > AD_SPEND_CSV_MAX_ROWS)
    return {
      rows: [],
      errors: [{ line: 1, message: `Ko'pi bilan ${AD_SPEND_CSV_MAX_ROWS} qator` }],
    };

  const rows: AdSpendRow[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const get = (name: string) => (col(name) >= 0 ? (cells[col(name)] ?? '').trim() : '');
    const problems: string[] = [];
    const date = parseDay(get('date'));
    if (!date) problems.push("sana noto'g'ri (YYYY-MM-DD)");
    const rawPlatform = get('platform').toLowerCase();
    const platform = (AD_PLATFORMS as string[]).includes(rawPlatform)
      ? (rawPlatform as AdPlatform)
      : adPlatformOfSource(rawPlatform);
    if (!platform) problems.push(`platforma noma'lum: ${get('platform') || '—'}`);
    const campaignId = get('campaign_id');
    if (!campaignId || campaignId.length > 128) problems.push('campaign_id kerak (≤ 128 belgi)');
    const campaign = get('campaign') || campaignId;
    if (campaign.length > 256) problems.push('kampaniya nomi juda uzun');
    const adset = get('adset') || null;
    if (adset && adset.length > 256) problems.push('adset juda uzun');
    const spendTiyin = parseSoum(get('spend'), delimiter === ';');
    if (spendTiyin === null) problems.push(`xarajat noto'g'ri: ${get('spend') || '—'}`);
    const impressions = parseCount(get('impressions'));
    const clicks = parseCount(get('clicks'));
    if (impressions === null) problems.push("ko'rsatishlar butun son bo'lishi kerak");
    if (clicks === null) problems.push("bosishlar butun son bo'lishi kerak");
    if (problems.length) {
      errors.push({ line, message: problems.join('; ') });
      return;
    }
    const key = `${date}|${platform}|${campaignId}`;
    if (seen.has(key)) {
      errors.push({
        line,
        message: `takroriy qator (${seen.get(key)}-qator bilan bir xil kun/kampaniya)`,
      });
      return;
    }
    seen.set(key, line);
    rows.push({
      date: date!,
      platform: platform!,
      campaignId,
      campaign,
      adset,
      spendTiyin: spendTiyin!,
      impressions: impressions!,
      clicks: clicks!,
    });
  });
  if (!errors.length && rows.length === 0)
    errors.push({ line: 2, message: "Ma'lumot qatorlari yo'q" });
  return errors.length ? { rows: [], errors } : { rows, errors };
}
