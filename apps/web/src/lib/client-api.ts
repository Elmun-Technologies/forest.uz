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
  AddressDto,
  AddressUpdateInput,
  ApiErrorBody,
  CartDto,
  CheckoutResultDto,
  ConsentsDto,
  DataDeleteRequestDto,
  DeliveryOptionDto,
  LeadResultDto,
  MeDto,
  MeUpdateInput,
  ProductCardDto,
  ProductListDto,
  ProductReviewsDto,
  SearchResultDto,
} from '@forest/contracts';
import type { TelegramAuthPayload } from './telegram-widget';

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
  extraHeaders: Record<string, string> = {},
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
        ...extraHeaders,
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

/** Body of POST /checkout/orders (the API normalizes the phone to E.164). */
export interface CheckoutRequest {
  name: string;
  phone: string;
  region: string;
  district: string | null;
  addressLine: string;
  lat: number | null;
  lng: number | null;
  zoneKey: string;
  paymentMethod: 'PAYME' | 'CLICK' | 'COD';
  comment: string | null;
  offerVersion: string;
  consents: { smsMarketing: boolean; telegram: boolean };
}

export interface AddressInput {
  label: string | null;
  region: string;
  district: string | null;
  line: string;
  isDefault: boolean;
}

const enc = encodeURIComponent;
const pinQuery = (pin?: { lat: number; lng: number } | null) =>
  pin ? `&lat=${pin.lat.toFixed(6)}&lng=${pin.lng.toFixed(6)}` : '';

export const clientApi = {
  cart: {
    /**
     * `zone` prices shipping for that delivery zone (checkout); default = the express zone.
     * With `pin` a zone that has the live carrier quote on is priced like `/cart/quote`.
     */
    get: (zone?: string, pin?: { lat: number; lng: number } | null) =>
      request<CartDto>('GET', zone ? `/cart?zone=${enc(zone)}${pinQuery(pin)}` : '/cart'),
    addItem: (input: { variantId: string; qty: number }) =>
      request<CartDto>('POST', '/cart/items', input),
    setQty: (variantId: string, qty: number) =>
      request<CartDto>('PATCH', `/cart/items/${encodeURIComponent(variantId)}`, { qty }),
    remove: (variantId: string) =>
      request<CartDto>('DELETE', `/cart/items/${encodeURIComponent(variantId)}`),
    applyPromo: (code: string) => request<CartDto>('POST', '/cart/promo', { code }),
    removePromo: () => request<CartDto>('DELETE', '/cart/promo'),
    /** `pin` (checkout geolocation) lets zones with a live carrier quote price the trip. */
    quote: (region: string, district?: string | null, pin?: { lat: number; lng: number } | null) =>
      request<DeliveryOptionDto[]>(
        'GET',
        `/cart/quote?region=${enc(region)}${district ? `&district=${enc(district)}` : ''}${pinQuery(pin)}`,
      ),
  },
  checkout: {
    /** One Idempotency-Key per submit attempt; resend the same key when retrying that attempt. */
    place: (input: CheckoutRequest, idempotencyKey: string) =>
      request<CheckoutResultDto>('POST', '/checkout/orders', input, {
        'Idempotency-Key': idempotencyKey,
      }),
  },
  orders: {
    pay: (publicId: string, method: 'PAYME' | 'CLICK') =>
      request<{ url: string }>('POST', `/orders/${enc(publicId)}/pay`, { method }),
  },
  track: {
    changeAddress: (token: string, input: { addressLine: string; district: string | null }) =>
      request<{ ok: true }>('PATCH', `/track/${enc(token)}/address`, input),
  },
  auth: {
    sendOtp: (phone: string) =>
      request<{ resendInSec: number; expiresInSec: number }>('POST', '/auth/otp/send', { phone }),
    verifyOtp: (phone: string, code: string) =>
      request<MeDto>('POST', '/auth/otp/verify', { phone, code }),
    /** Telegram Login Widget `onauth` payload, passed through unchanged (all fields are signed). */
    telegram: (payload: TelegramAuthPayload) => request<MeDto>('POST', '/auth/telegram', payload),
    logout: () => request<void>('POST', '/auth/logout'),
  },
  me: {
    get: () => request<MeDto>('GET', '/me'),
    update: (input: MeUpdateInput) => request<MeDto>('PATCH', '/me', input),
    linkTelegram: (payload: TelegramAuthPayload) =>
      request<MeDto>('POST', '/me/telegram/link', payload),
    addresses: () => request<AddressDto[]>('GET', '/me/addresses'),
    addAddress: (input: AddressInput) => request<AddressDto>('POST', '/me/addresses', input),
    updateAddress: (id: string, input: AddressUpdateInput) =>
      request<AddressDto>('PATCH', `/me/addresses/${enc(id)}`, input),
    deleteAddress: (id: string) => request<void>('DELETE', `/me/addresses/${enc(id)}`),
    favorites: () => request<ProductCardDto[]>('GET', '/me/favorites'),
    addFavorite: (productId: string) => request<void>('POST', '/me/favorites', { productId }),
    removeFavorite: (productId: string) =>
      request<void>('DELETE', `/me/favorites/${enc(productId)}`),
    consents: (input: Partial<ConsentsDto>) => request<ConsentsDto>('PATCH', '/me/consents', input),
    exportData: () => request<Record<string, unknown>>('POST', '/me/data-export'),
    requestDeletion: () => request<DataDeleteRequestDto>('POST', '/me/data-delete'),
  },
  dev: {
    /** Fake Payme/Click callback (PROVIDERS_MODE=fake only). */
    fakePay: (order: string, result: 'success' | 'fail') =>
      request<{ ok: true; publicId: string }>('POST', '/dev/fake-pay', { order, result }),
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
    reviews: (slug: string, page: number) =>
      request<ProductReviewsDto>('GET', `/catalog/products/${enc(slug)}/reviews?page=${page}`),
  },
};
