import type { HttpClient } from '../http-client';
import type {
  HealthResult,
  InventoryItem,
  InventoryItemType,
  InventoryMapping,
  InventoryOrderInput,
  InventoryProvider,
} from './types';

/**
 * MoySklad JSON API 1.2 (`api.moysklad.ru/api/remap/1.2`): catalog + stock pull, customer orders.
 * Sources (official doc snippets + open-source clients), the fields relied on and what is
 * unverified: docs/runbooks/moysklad.md. Parsers/builders are pure and unit-tested.
 */

export const MOYSKLAD_DEFAULT_API_URL = 'https://api.moysklad.ru/api/remap/1.2';

/** Documented: at most 1000 rows per list page; with `expand` at most 100. */
const PAGE = 1000;
const EXPAND_PAGE = 100;
const MAX_PAGES = 200;

// ── Rate limits (documented: 45 requests / 3 s per account, 5 parallel per user) ──

export interface MoyskladFetchOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Parallel requests per process (we stay well below MoySklad's 5 per user). */
  maxParallel?: number;
  /** 429 retries; MoySklad rejects a 429 request before executing it, so any method may retry. */
  max429Retries?: number;
}

/** `X-Lognex-Auth` value MoySklad sends on a 429 caused by the parallel-request limit. */
export const PARALLEL_LIMIT_CODE = '429005';
const MAX_WAIT_MS = 30_000;

/** How long to wait after a 429: `X-Lognex-Retry-After` (ms), else a short/backoff wait. */
export function moysklad429DelayMs(headers: Headers, attempt: number): number {
  const ra = Number.parseInt(headers.get('x-lognex-retry-after') ?? '', 10);
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra, MAX_WAIT_MS);
  if (headers.get('x-lognex-auth') === PARALLEL_LIMIT_CODE) return 250 * attempt;
  return Math.min(1000 * 2 ** (attempt - 1), MAX_WAIT_MS);
}

/**
 * Pause before the next request when the window is almost spent: interval / limit per request
 * (`X-Lognex-Retry-TimeInterval` ms over `X-RateLimit-Limit`), only below 10 % remaining.
 */
export function moyskladThrottleMs(headers: Headers): number {
  const limit = Number.parseInt(headers.get('x-ratelimit-limit') ?? '', 10);
  const remaining = Number.parseInt(headers.get('x-ratelimit-remaining') ?? '', 10);
  const interval = Number.parseInt(headers.get('x-lognex-retry-timeinterval') ?? '', 10);
  if (!(limit > 0) || !Number.isFinite(remaining) || !(interval > 0)) return 0;
  if (remaining > limit * 0.1) return 0;
  return Math.min(Math.ceil(interval / limit), 1000);
}

/**
 * A `fetch` for `HttpClient` that enforces MoySklad's limits: a per-process semaphore, 429 retry
 * with the documented headers, and throttling from `X-RateLimit-Remaining`. `HttpClient` above it
 * keeps the timeout, the GET-only retries for 5xx/network errors and the circuit breaker.
 */
export function createMoyskladFetch(opts: MoyskladFetchOptions = {}): typeof fetch {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxParallel = Math.max(1, opts.maxParallel ?? 2);
  const max429 = opts.max429Retries ?? 5;
  let inflight = 0;
  const waiters: (() => void)[] = [];
  const acquire = async () => {
    while (inflight >= maxParallel) await new Promise<void>((r) => waiters.push(r));
    inflight++;
  };
  const release = () => {
    inflight--;
    waiters.shift()?.();
  };

  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    await acquire();
    try {
      for (let attempt = 1; ; attempt++) {
        const res = await fetchImpl(input, init);
        if (res.status === 429 && attempt <= max429) {
          await res.arrayBuffer().catch(() => undefined);
          await sleep(moysklad429DelayMs(res.headers, attempt));
          continue;
        }
        const pause = moyskladThrottleMs(res.headers);
        if (pause > 0) await sleep(pause);
        return res;
      }
    } finally {
      release();
    }
  }) as typeof fetch;
}

// ── Pure parsing helpers ──

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Last path segment of a MoySklad `meta.href` (the entity id); query string ignored. */
export function idFromHref(href: unknown): string | null {
  const s = str(href);
  if (!s) return null;
  const path = s.split('?')[0] ?? '';
  const id = path.split('/').filter(Boolean).at(-1);
  return id && /^[0-9a-f-]{32,36}$/i.test(id) ? id.toLowerCase() : null;
}

/**
 * Prices are numbers in the currency's minor unit ("в копейках"). In a UZS account that unit is
 * the tiyin; rounding absorbs float noise (`32900000.000000004`). Negative/garbage → null.
 */
export function msMinorToTiyin(value: unknown): bigint | null {
  const n = num(value);
  if (n === null || n < 0 || n > 1e15) return null;
  return BigInt(Math.round(n));
}

export function tiyinToMsMinor(tiyin: bigint): number {
  return Number(tiyin);
}

export interface SalePrice {
  /** Tiyin; null when the value is missing or ≤ 0 (MoySklad sends 0 for an unset price). */
  tiyin: bigint | null;
  currencyId: string | null;
}

/** `salePrices[]` entry whose `priceType.name` matches (case-insensitive); null if missing. */
export function salePrice(salePrices: unknown, priceType: string): SalePrice | null {
  if (!Array.isArray(salePrices)) return null;
  const want = priceType.trim().toLowerCase();
  for (const p of salePrices) {
    if (!isObj(p) || !isObj(p.priceType)) continue;
    if (str(p.priceType.name)?.toLowerCase() !== want) continue;
    const tiyin = msMinorToTiyin(p.value);
    return {
      tiyin: tiyin !== null && tiyin > 0n ? tiyin : null,
      currencyId:
        isObj(p.currency) && isObj(p.currency.meta) ? idFromHref(p.currency.meta.href) : null,
    };
  }
  return null;
}

export function salePriceTiyin(salePrices: unknown, priceType: string): bigint | null {
  return salePrice(salePrices, priceType)?.tiyin ?? null;
}

/** `entity/currency` rows → id → ISO code (`isoCode`, e.g. "UZS"; numeric `code` 860). */
export function parseCurrencies(rows: unknown[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!isObj(r)) continue;
    const id = str(r.id)?.toLowerCase();
    const iso = str(r.isoCode)?.toUpperCase() ?? (str(r.code) === '860' ? 'UZS' : null);
    if (id && iso) out.set(id, iso);
  }
  return out;
}

/** The account currency (`default: true`) as ISO code; null when not listed. */
export function defaultCurrency(rows: unknown[]): string | null {
  const d = rows.filter(isObj).find((r) => r.default === true);
  return d ? (parseCurrencies([d]).values().next().value ?? null) : null;
}

export interface ProductPriceInfo {
  priceTiyin: bigint | null;
  priceCurrency: string | null;
  ikpu: string | null;
}

/** Custom attribute value by name (case-insensitive) as a string; null when absent/empty. */
export function attributeValue(attributes: unknown, name: string): string | null {
  if (!Array.isArray(attributes)) return null;
  const want = name.trim().toLowerCase();
  for (const a of attributes) {
    if (!isObj(a) || str(a.name)?.toLowerCase() !== want) continue;
    const v = a.value;
    if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
    if (typeof v === 'string') return v.trim() || null;
    // Custom-entity (directory) attributes carry `{ name }`.
    if (isObj(v)) return str(v.name);
    return null;
  }
  return null;
}

/** IKPU (MXIK) = exactly 17 digits (CLAUDE.md §6); spaces/dashes from manual entry dropped. */
export function normalizeIkpu(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{17}$/.test(digits) && !/^0+$/.test(digits) ? digits : null;
}

/** Whole sellable units from a MoySklad quantity (fractions and negatives → down / 0). */
export function stockUnits(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value + 1e-9)) : 0;
}

/** Kit availability = min over components of ⌊free stock / qty per kit⌋ (CLAUDE.md §6). */
export function bundleStock(
  components: { externalId: string; qty: number }[],
  stock: ReadonlyMap<string, number>,
): number {
  if (!components.length) return 0;
  let min = Number.POSITIVE_INFINITY;
  for (const c of components) {
    if (!(c.qty > 0)) continue;
    min = Math.min(min, Math.floor(stockUnits(stock.get(c.externalId) ?? 0) / c.qty));
  }
  return Number.isFinite(min) ? min : 0;
}

/**
 * One row of entity/product|variant|bundle (or entity/assortment) → InventoryItem. Services,
 * consignments and malformed rows → null. Variants without their own price take the product's
 * (`productPrices`) — MoySklad shows the product price for them too.
 */
export function parseAssortmentRow(
  row: unknown,
  mapping: InventoryMapping,
  productInfo?: ReadonlyMap<string, ProductPriceInfo>,
  currencies?: ReadonlyMap<string, string>,
): InventoryItem | null {
  if (!isObj(row) || !isObj(row.meta)) return null;
  const type = str(row.meta.type);
  if (type !== 'product' && type !== 'variant' && type !== 'bundle') return null;
  const externalId = str(row.id)?.toLowerCase() ?? idFromHref(row.meta.href);
  const name = str(row.name);
  if (!externalId || !name) return null;
  const parentExternalId =
    type === 'variant' && isObj(row.product) && isObj(row.product.meta)
      ? idFromHref(row.product.meta.href)
      : null;
  if (type === 'variant' && !parentExternalId) return null;
  const parent = parentExternalId ? productInfo?.get(parentExternalId) : undefined;
  const own = salePrice(row.salePrices, mapping.priceType);
  const ownCurrency = own?.currencyId ? (currencies?.get(own.currencyId) ?? null) : null;
  // A price in another currency is unusable (minor units would not be tiyin).
  const foreign = ownCurrency !== null && ownCurrency !== 'UZS';
  const ownUsable = own?.tiyin != null && !foreign;
  const price: { priceTiyin: bigint | null; priceCurrency: string | null } = ownUsable
    ? { priceTiyin: own.tiyin, priceCurrency: null }
    : type === 'variant' && parent && !foreign
      ? { priceTiyin: parent.priceTiyin, priceCurrency: parent.priceCurrency }
      : { priceTiyin: null, priceCurrency: foreign ? ownCurrency : null };
  const label =
    type === 'variant' && Array.isArray(row.characteristics)
      ? row.characteristics
          .filter(isObj)
          .map((c) => str(c.value))
          .filter((v): v is string => v !== null)
          .join(', ') || null
      : null;
  const components: { externalId: string; qty: number }[] = [];
  if (type === 'bundle' && isObj(row.components) && Array.isArray(row.components.rows)) {
    for (const c of row.components.rows) {
      if (!isObj(c) || !isObj(c.assortment) || !isObj(c.assortment.meta)) continue;
      const id = idFromHref(c.assortment.meta.href);
      const qty = num(c.quantity);
      if (id && qty !== null && qty > 0) components.push({ externalId: id, qty });
    }
  }
  return {
    externalId,
    type,
    parentExternalId,
    name: name.slice(0, 255),
    sku: str(type === 'variant' ? row.code : row.article)?.slice(0, 64) ?? null,
    ikpu:
      type === 'variant'
        ? (parent?.ikpu ?? null)
        : attributeValue(row.attributes, mapping.ikpuAttribute),
    ...price,
    archived: row.archived === true,
    hasVariants: type === 'product' && (num(row.variantsCount) ?? 0) > 0,
    label,
    components,
  };
}

/**
 * Short stock report rows (`report/stock/{all|bystore}/current?stockType=freeStock`) → free stock
 * per assortment id. With a store, only that store's rows count (rows without `storeId` hold
 * reserves not bound to a store and are ignored).
 */
export function parseStockCurrent(rows: unknown, storeId: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(rows)) return out;
  const store = storeId?.toLowerCase() ?? null;
  for (const r of rows) {
    if (!isObj(r)) continue;
    const id = str(r.assortmentId)?.toLowerCase();
    const value = num(r.freeStock);
    if (!id || value === null) continue;
    if (store !== null && str(r.storeId)?.toLowerCase() !== store) continue;
    out.set(id, (out.get(id) ?? 0) + value);
  }
  return out;
}

export interface MoyskladWebhookEvent {
  type: InventoryItemType;
  externalId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
}

/**
 * Webhook body → what to re-read. Entity webhooks carry `events[]` (meta.type/href, action);
 * a stock webhook carries `reportUrl`/`stockType`. Unknown shapes → nothing (the endpoint still
 * answers 200; the next poll catches up).
 */
export function parseWebhookBody(body: unknown): {
  events: MoyskladWebhookEvent[];
  stock: boolean;
} {
  const events: MoyskladWebhookEvent[] = [];
  if (!isObj(body)) return { events, stock: false };
  if (Array.isArray(body.events)) {
    for (const e of body.events.slice(0, 1000)) {
      if (!isObj(e) || !isObj(e.meta)) continue;
      const type = str(e.meta.type);
      const action = str(e.action);
      const externalId = idFromHref(e.meta.href);
      if (
        (type === 'product' || type === 'variant' || type === 'bundle') &&
        (action === 'CREATE' || action === 'UPDATE' || action === 'DELETE') &&
        externalId
      )
        events.push({ type, externalId, action });
    }
  }
  const stock = Boolean(str(body.reportUrl) || str(body.stockType));
  return { events, stock };
}

/** States live under the document's metadata: `entity/customerorder/metadata/states/<id>`. */
export function stateRef(href: (type: string, id: string) => string, stateId: string) {
  return {
    meta: {
      href: href('customerorder/metadata/states', stateId),
      type: 'state',
      mediaType: 'application/json',
    },
  };
}

/** customerorder POST body (positions price in minor units = tiyin; `reserve` per position). */
export function buildCustomerOrderBody(
  input: InventoryOrderInput,
  refs: {
    href: (type: string, id: string) => string;
    organizationId: string;
    stateId: string | null;
    attributeId: string | null;
  },
) {
  const meta = (type: string, id: string) => ({
    meta: { href: refs.href(type, id), type, mediaType: 'application/json' },
  });
  return {
    name: input.name.slice(0, 255),
    organization: meta('organization', refs.organizationId),
    agent: meta('counterparty', input.counterpartyId),
    ...(input.storeId ? { store: meta('store', input.storeId) } : {}),
    ...(refs.stateId ? { state: stateRef(refs.href, refs.stateId) } : {}),
    description: input.description.slice(0, 4000),
    ...(refs.attributeId && input.attribute
      ? {
          attributes: [
            {
              meta: {
                href: refs.href('customerorder/metadata/attributes', refs.attributeId),
                type: 'attributemetadata',
                mediaType: 'application/json',
              },
              value: input.attribute.value.slice(0, 255),
            },
          ],
        }
      : {}),
    positions: input.positions.map((p) => ({
      quantity: p.qty,
      price: tiyinToMsMinor(p.priceTiyin),
      discount: Math.round(p.discountPercent * 100) / 100,
      reserve: input.reserve ? p.qty : 0,
      assortment: meta(p.type, p.externalId),
    })),
  };
}

export class MoyskladApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`moysklad ${status} ${code}: ${message}`.slice(0, 300));
    this.name = 'MoyskladApiError';
  }
}

/** `{ errors: [{ error, code, error_message }] }` → first error. */
export function parseMoyskladError(status: number, body: unknown): MoyskladApiError {
  const first = isObj(body) && Array.isArray(body.errors) ? body.errors.find(isObj) : undefined;
  const code = first
    ? String(num(first.code) ?? str(first.code) ?? `http_${status}`)
    : `http_${status}`;
  const message = first ? (str(first.error_message) ?? str(first.error) ?? '') : '';
  return new MoyskladApiError(status, code, message);
}

export interface MoyskladProviderOptions {
  http: HttpClient;
  baseUrl?: string;
}

interface ListPage {
  rows: unknown[];
  nextHref: string | null;
}

function parseListPage(body: unknown): ListPage {
  if (!isObj(body) || !Array.isArray(body.rows))
    throw new MoyskladApiError(200, 'bad_response', 'list without rows');
  const meta = isObj(body.meta) ? body.meta : {};
  return { rows: body.rows, nextHref: str(meta.nextHref) };
}

const WEBHOOK_ENTITIES = ['product', 'variant', 'bundle'] as const;
const WEBHOOK_ACTIONS = ['CREATE', 'UPDATE', 'DELETE'] as const;

export class MoyskladInventoryProvider implements InventoryProvider {
  readonly key = 'moysklad' as const;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    credentials: Record<string, string>,
    private readonly opts: MoyskladProviderOptions,
  ) {
    this.token = credentials.token ?? '';
    this.baseUrl = (opts.baseUrl || MOYSKLAD_DEFAULT_API_URL).replace(/\/+$/, '');
  }

  /** Entity href for request bodies (MoySklad references are `meta.href` URLs). */
  href = (type: string, id: string): string => `${this.baseUrl}/entity/${type}/${id}`;

  private async call(
    method: 'GET' | 'POST' | 'PUT',
    pathOrUrl: string,
    opts: { query?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
  ): Promise<unknown> {
    const url = new URL(
      pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}/${pathOrUrl.replace(/^\//, '')}`,
    );
    // Only follow links on our own API host (nextHref comes from the response).
    if (!url.href.startsWith(`${this.baseUrl}/`))
      throw new MoyskladApiError(0, 'bad_href', 'link outside the API base');
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const res = await this.opts.http.request({
      method,
      url: url.toString(),
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json;charset=utf-8',
        // Mandatory for the JSON API; fetch (undici) decompresses the gzip response.
        'Accept-Encoding': 'gzip',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      // PUTs here set absolute values (state, reserve 0): repeating them is harmless.
      idempotent: method !== 'POST',
      timeoutMs: opts.timeoutMs ?? 20_000,
    });
    let data: unknown = null;
    if (res.text) {
      try {
        data = JSON.parse(res.text);
      } catch {
        data = null;
      }
    }
    if (res.status < 200 || res.status >= 300) throw parseMoyskladError(res.status, data);
    return data;
  }

  private async listAll(path: string, query: Record<string, string>): Promise<unknown[]> {
    const rows: unknown[] = [];
    let next: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = parseListPage(
        next
          ? await this.call('GET', next, { timeoutMs: 30_000 })
          : await this.call('GET', path, { query, timeoutMs: 30_000 }),
      );
      rows.push(...body.rows);
      if (!body.nextHref || body.rows.length === 0) return rows;
      next = body.nextHref;
    }
    throw new MoyskladApiError(0, 'too_many_pages', `${path}: more than ${MAX_PAGES} pages`);
  }

  /** Cheap authenticated GET; with a mapping, also checks the price type exists. */
  async test(mapping?: InventoryMapping): Promise<HealthResult> {
    if (!this.token) return { ok: false, message: 'token is required' };
    try {
      await this.call('GET', 'entity/organization', { query: { limit: '1' } });
      const currency = defaultCurrency(
        await this.listAll('entity/currency', { limit: String(PAGE) }),
      );
      if (currency && currency !== 'UZS')
        return {
          ok: false,
          message: `account currency is ${currency}; prices must be in UZS (tiyin) — not synced`,
        };
      if (mapping) {
        const types = await this.call('GET', 'context/companysettings/pricetype');
        const names = Array.isArray(types)
          ? types.filter(isObj).map((t) => str(t.name)?.toLowerCase())
          : [];
        if (!names.includes(mapping.priceType.trim().toLowerCase()))
          return {
            ok: true,
            message: `token ok; price type "${mapping.priceType}" not found in MoySklad — set it on the MoySklad page`,
          };
      }
      return { ok: true, message: 'token ok' };
    } catch (e) {
      if (e instanceof MoyskladApiError && (e.status === 401 || e.status === 403))
        return { ok: false, message: 'token rejected by MoySklad (401/403)' };
      return { ok: false, message: `MoySklad API unreachable: ${String(e).slice(0, 200)}` };
    }
  }

  async listAssortment(mapping: InventoryMapping): Promise<InventoryItem[]> {
    const [products, variants, bundles] = [
      await this.listAll('entity/product', { limit: String(PAGE) }),
      await this.listAll('entity/variant', { limit: String(PAGE) }),
      await this.listAll('entity/bundle', { limit: String(EXPAND_PAGE), expand: 'components' }),
    ];
    const currencies = await this.currencies();
    const items: InventoryItem[] = [];
    const productInfo = new Map<string, ProductPriceInfo>();
    for (const row of products) {
      const item = parseAssortmentRow(row, mapping, undefined, currencies);
      if (!item) continue;
      productInfo.set(item.externalId, item);
      items.push(item);
    }
    for (const row of [...variants, ...bundles]) {
      const item = parseAssortmentRow(row, mapping, productInfo, currencies);
      if (item) items.push(item);
    }
    return items;
  }

  private async currencies(): Promise<Map<string, string>> {
    return parseCurrencies(await this.listAll('entity/currency', { limit: String(PAGE) }));
  }

  private async getOne(type: InventoryItemType, id: string): Promise<unknown> {
    try {
      return await this.call('GET', `entity/${type}/${id}`, {
        query: type === 'bundle' ? { expand: 'components' } : {},
      });
    } catch (e) {
      if (e instanceof MoyskladApiError && e.status === 404) return null;
      throw e;
    }
  }

  async getItem(
    type: InventoryItemType,
    externalId: string,
    mapping: InventoryMapping,
  ): Promise<InventoryItem[] | null> {
    const row = await this.getOne(type, externalId);
    if (row === null) return null;
    const currencies = await this.currencies();
    if (type === 'variant') {
      const parentId =
        isObj(row) && isObj(row.product) && isObj(row.product.meta)
          ? idFromHref(row.product.meta.href)
          : null;
      const parentRow = parentId ? await this.getOne('product', parentId) : null;
      const parent = parentRow
        ? parseAssortmentRow(parentRow, mapping, undefined, currencies)
        : null;
      const info = new Map<string, ProductPriceInfo>(parent ? [[parent.externalId, parent]] : []);
      const item = parseAssortmentRow(row, mapping, info, currencies);
      return item ? [item] : [];
    }
    const item = parseAssortmentRow(row, mapping, undefined, currencies);
    if (!item) return [];
    if (!item.hasVariants) return [item];
    // A product's price/IKPU flow into its variants: refresh them together.
    const variants = await this.listAll('entity/variant', {
      limit: String(PAGE),
      filter: `productid=${item.externalId}`,
    });
    const info = new Map<string, ProductPriceInfo>([[item.externalId, item]]);
    return [
      item,
      ...variants
        .map((v) => parseAssortmentRow(v, mapping, info, currencies))
        .filter((v): v is InventoryItem => v !== null),
    ];
  }

  async stockLevels(storeId: string | null): Promise<Map<string, number>> {
    const rows = await this.call(
      'GET',
      storeId ? 'report/stock/bystore/current' : 'report/stock/all/current',
      { query: { stockType: 'freeStock', include: 'zeroLines' }, timeoutMs: 30_000 },
    );
    if (!Array.isArray(rows)) throw new MoyskladApiError(200, 'bad_response', 'stock report');
    return parseStockCurrent(rows, storeId);
  }

  async findCustomerOrder(name: string): Promise<string | null> {
    const page = parseListPage(
      await this.call('GET', 'entity/customerorder', {
        query: { filter: `name=${name}`, limit: '1' },
      }),
    );
    const row = page.rows.find(isObj);
    return row ? (str(row.id)?.toLowerCase() ?? null) : null;
  }

  async findOrCreateCounterparty(input: {
    phone: string;
    name: string;
  }): Promise<{ id: string; created: boolean }> {
    // Exact match only (MoySklad has no partial phone filter): we always write E.164.
    const page = parseListPage(
      await this.call('GET', 'entity/counterparty', {
        query: { filter: `phone=${input.phone}`, limit: '1' },
      }),
    );
    const found = page.rows.find(isObj);
    const foundId = found ? str(found.id) : null;
    if (foundId) return { id: foundId.toLowerCase(), created: false };
    const created = await this.call('POST', 'entity/counterparty', {
      body: {
        name: (input.name.trim() || input.phone).slice(0, 255),
        phone: input.phone,
        companyType: 'individual',
      },
    });
    const id = isObj(created) ? str(created.id) : null;
    if (!id) throw new MoyskladApiError(200, 'bad_response', 'counterparty without id');
    return { id: id.toLowerCase(), created: true };
  }

  private async customerOrderMetadata(): Promise<{
    states: { id: string; name: string }[];
    attributes: { id: string; name: string; type: string }[];
  }> {
    const meta = await this.call('GET', 'entity/customerorder/metadata');
    const states =
      isObj(meta) && Array.isArray(meta.states)
        ? meta.states
            .filter(isObj)
            .map((s) => ({ id: str(s.id) ?? '', name: str(s.name) ?? '' }))
            .filter((s) => s.id && s.name)
        : [];
    const attrs = await this.call('GET', 'entity/customerorder/metadata/attributes').catch(
      () => null,
    );
    const attributes =
      isObj(attrs) && Array.isArray(attrs.rows)
        ? attrs.rows
            .filter(isObj)
            .map((a) => ({ id: str(a.id) ?? '', name: str(a.name) ?? '', type: str(a.type) ?? '' }))
            .filter((a) => a.id && a.name)
        : [];
    return { states, attributes };
  }

  private stateId(states: { id: string; name: string }[], name: string): string {
    const want = name.trim().toLowerCase();
    const s = states.find((x) => x.name.toLowerCase() === want);
    if (!s) throw new MoyskladApiError(0, 'state_not_found', `state "${name}" not in MoySklad`);
    return s.id;
  }

  async createCustomerOrder(input: InventoryOrderInput): Promise<string> {
    let organizationId = input.organizationId;
    if (!organizationId) {
      const orgs = parseListPage(
        await this.call('GET', 'entity/organization', { query: { limit: '1' } }),
      );
      const org = orgs.rows.find(isObj);
      organizationId = org ? str(org.id) : null;
      if (!organizationId)
        throw new MoyskladApiError(0, 'organization_missing', 'no organization in MoySklad');
    }
    const needMeta = Boolean(input.stateName || input.attribute);
    const meta = needMeta ? await this.customerOrderMetadata() : { states: [], attributes: [] };
    const stateId = input.stateName ? this.stateId(meta.states, input.stateName) : null;
    const attr = input.attribute
      ? meta.attributes.find(
          (a) =>
            a.name.toLowerCase() === input.attribute!.name.trim().toLowerCase() &&
            (a.type === 'string' || a.type === 'text'),
        )
      : undefined;
    const body = buildCustomerOrderBody(input, {
      href: this.href,
      organizationId,
      stateId,
      attributeId: attr?.id ?? null,
    });
    const created = await this.call('POST', 'entity/customerorder', { body, timeoutMs: 30_000 });
    const id = isObj(created) ? str(created.id) : null;
    if (!id) throw new MoyskladApiError(200, 'bad_response', 'customerorder without id');
    return id.toLowerCase();
  }

  async updateCustomerOrder(
    externalId: string,
    change: { stateName: string | null; clearReserve: boolean },
  ): Promise<void> {
    if (change.stateName) {
      const { states } = await this.customerOrderMetadata();
      const stateId = this.stateId(states, change.stateName);
      await this.call('PUT', `entity/customerorder/${externalId}`, {
        body: { state: stateRef(this.href, stateId) },
      });
    }
    if (change.clearReserve) {
      const positions = await this.listAll(`entity/customerorder/${externalId}/positions`, {
        limit: String(PAGE),
      });
      for (const p of positions) {
        if (!isObj(p) || !(num(p.reserve) ?? 0)) continue;
        const posId = str(p.id);
        if (posId)
          await this.call('PUT', `entity/customerorder/${externalId}/positions/${posId}`, {
            body: { reserve: 0 },
          });
      }
    }
  }

  async registerWebhooks(
    url: string,
    opts: { byStore: boolean },
  ): Promise<{ created: number; existing: number }> {
    let created = 0;
    let existing = 0;
    const hooks = await this.listAll('entity/webhook', { limit: String(PAGE) });
    const have = new Set(
      hooks
        .filter(isObj)
        .filter((h) => str(h.url) === url)
        .map((h) => `${str(h.entityType)}:${str(h.action)}`),
    );
    for (const entityType of WEBHOOK_ENTITIES)
      for (const action of WEBHOOK_ACTIONS) {
        if (have.has(`${entityType}:${action}`)) {
          existing++;
          continue;
        }
        await this.call('POST', 'entity/webhook', {
          body: { url, action, entityType, method: 'POST' },
        });
        created++;
      }
    const stockHooks = await this.listAll('entity/webhookstock', { limit: String(PAGE) });
    if (stockHooks.filter(isObj).some((h) => str(h.url) === url)) existing++;
    else {
      await this.call('POST', 'entity/webhookstock', {
        body: {
          url,
          enabled: true,
          stockType: 'stock',
          reportType: opts.byStore ? 'bystore' : 'all',
        },
      });
      created++;
    }
    return { created, existing };
  }
}
