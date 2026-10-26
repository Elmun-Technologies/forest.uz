/**
 * Typed browser client for the storefront API. Always goes through the same-origin rewrite
 * `/api/*` → `API_INTERNAL_URL/v1/*`, so `fr_session` / `fr_cart` cookies stay first-party.
 *
 *   const cart = await clientApi.cart.addItem({ variantId, qty: 1 });
 *
 * Errors are thrown as `ClientApiError` with the API's stable `code` and localized `message`
 * (the API localizes by the `Accept-Language` we send = the page locale, not the browser's).
 */
import type {
  ApiErrorBody,
  CartDto,
  LeadResultDto,
  ProductListDto,
  SearchResultDto,
} from '@forest/contracts';

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

function pageLocale(): string {
  return typeof document === 'undefined' ? 'uz' : document.documentElement.lang || 'uz';
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Accept-Language': pageLocale(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ClientApiError(0, 'NETWORK', 'network');
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ClientApiError(
      res.status,
      err?.error.code ?? `HTTP_${res.status}`,
      err?.error.message ?? `HTTP ${res.status}`,
      err?.error.field,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const clientApi = {
  cart: {
    get: () => request<CartDto>('GET', '/cart'),
    addItem: (input: { variantId: string; qty: number }) =>
      request<CartDto>('POST', '/cart/items', input),
    setQty: (variantId: string, qty: number) =>
      request<CartDto>('PATCH', `/cart/items/${encodeURIComponent(variantId)}`, { qty }),
    remove: (variantId: string) =>
      request<CartDto>('DELETE', `/cart/items/${encodeURIComponent(variantId)}`),
  },
  leads: {
    /** `phone` in any format; the API normalizes to E.164. */
    create: (input: { phone: string; source: 'popup' | 'home' | 'footer' | 'selector' }) =>
      request<LeadResultDto>('POST', '/leads', input),
  },
  catalog: {
    products: (query: string) => request<ProductListDto>('GET', `/catalog/products${query}`),
    search: (q: string) =>
      request<SearchResultDto>('GET', `/catalog/search?q=${encodeURIComponent(q)}`),
    waitlist: (input: { variantId: string; phone: string }) =>
      request<void>('POST', '/catalog/waitlist', input),
  },
};
