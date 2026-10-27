import { createHash, timingSafeEqual } from 'node:crypto';
import type { CheckoutInput, PaymentProvider } from './types';

/**
 * Click SHOP API helpers (Click calls our Prepare/Complete URLs).
 * Source of truth: click-llc/click-integration-php@1ca66fe (`BasicPaymentsErrors`,
 * `BasicPaymentMethods`) cross-checked with click-llc/click-integration-django@1af01d4
 * (`click/utils.py`). See docs/runbooks/payments.md.
 */

export const ClickAction = { PREPARE: 0, COMPLETE: 1 } as const;

/** Error codes and notes as in the official PHP library (`error_note` strings verbatim). */
export const ClickError = {
  SUCCESS: { error: 0, error_note: 'Success' },
  SIGN_CHECK_FAILED: { error: -1, error_note: 'SIGN CHECK FAILED!' },
  INCORRECT_AMOUNT: { error: -2, error_note: 'Incorrect parameter amount' },
  ACTION_NOT_FOUND: { error: -3, error_note: 'Action not found' },
  ALREADY_PAID: { error: -4, error_note: 'Already paid' },
  USER_NOT_FOUND: { error: -5, error_note: 'User does not exist' },
  TRANSACTION_NOT_FOUND: { error: -6, error_note: 'Transaction does not exist' },
  // -7 is listed in docs/06 but never produced by the official library; we use it when our own
  // write fails so Click retries instead of assuming success.
  UPDATE_FAILED: { error: -7, error_note: 'Failed to update user' },
  BAD_REQUEST: { error: -8, error_note: 'Error in request from click' },
  TRANSACTION_CANCELLED: { error: -9, error_note: 'Transaction cancelled' },
} as const;
export type ClickErrorEntry = (typeof ClickError)[keyof typeof ClickError];

/** Our payment row's `providerState` for a Click transaction. */
export const ClickTxnState = { PREPARED: 0, COMPLETED: 1, CANCELLED: -1 } as const;

/** Raw form fields as Click posts them (all strings; the signature is over these exact strings). */
export interface ClickRequest {
  click_trans_id: string;
  service_id: string;
  click_paydoc_id: string;
  merchant_trans_id: string;
  merchant_prepare_id?: string;
  amount: string;
  action: string;
  error: string;
  error_note: string;
  sign_time: string;
  sign_string: string;
}

const REQUIRED: (keyof ClickRequest)[] = [
  'click_trans_id',
  'service_id',
  'click_paydoc_id',
  'merchant_trans_id',
  'amount',
  'action',
  'error',
  'error_note',
  'sign_time',
  'sign_string',
];

/**
 * `is_not_possible_data`: every field present (`isset`), plus `merchant_prepare_id` for complete.
 * Returns the typed request or null (→ error -8).
 */
export function parseClickRequest(body: unknown): ClickRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of [...REQUIRED, 'merchant_prepare_id'] as const) {
    const v = b[k];
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number') out[k] = String(v);
  }
  if (REQUIRED.some((k) => out[k] === undefined)) return null;
  if (out.action === '1' && out.merchant_prepare_id === undefined) return null;
  return out as unknown as ClickRequest;
}

/**
 * `md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + [merchant_prepare_id if
 * action=1] + amount + action + sign_time)` — hex, lowercase.
 */
export function clickSignString(req: Omit<ClickRequest, 'sign_string'>, secretKey: string): string {
  return createHash('md5')
    .update(
      req.click_trans_id +
        req.service_id +
        secretKey +
        req.merchant_trans_id +
        (req.action === '1' ? (req.merchant_prepare_id ?? '') : '') +
        req.amount +
        req.action +
        req.sign_time,
    )
    .digest('hex');
}

export function isClickSignValid(req: ClickRequest, secretKey: string): boolean {
  const expected = Buffer.from(clickSignString(req, secretKey), 'utf8');
  const given = Buffer.from(req.sign_string.toLowerCase(), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Click amounts are decimal so'm strings ("329000", "329000.00"); we keep tiyin internally and
 * convert only here. Parsed exactly (no floats): the official library allows a 0.01 so'm
 * tolerance, which is the same as exact equality in tiyin. Null = not a valid amount.
 */
export function clickAmountToTiyin(amount: string): bigint | null {
  const m = /^(\d{1,15})(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m?.[1]) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? '0').padEnd(2, '0'));
}

export function tiyinToClickAmount(tiyin: bigint): string {
  const soum = tiyin / 100n;
  const rest = tiyin % 100n;
  return rest === 0n ? soum.toString() : `${soum}.${rest.toString().padStart(2, '0')}`;
}

/**
 * Integer id Click stores as merchant_prepare_id / merchant_confirm_id: the digits of our order
 * number (`F-10482` → 10482). Click documents these as integers; our row ids are cuids.
 */
export function clickMerchantId(orderNumber: string): number {
  const n = Number(orderNumber.replace(/^F-/, ''));
  return Number.isSafeInteger(n) ? n : 0;
}

/**
 * Hosted payment page (GET). UNVERIFIED: format from docs/06; the official Django module only
 * shows the legacy POST button form to https://my.click.uz/pay/ (MERCHANT_* fields).
 */
export function clickCheckoutUrl(input: {
  serviceId: string;
  merchantId: string;
  orderNumber: string;
  amountTiyin: bigint;
  returnUrl: string;
}): string {
  const url = new URL('https://my.click.uz/services/pay');
  url.searchParams.set('service_id', input.serviceId);
  url.searchParams.set('merchant_id', input.merchantId);
  url.searchParams.set('amount', tiyinToClickAmount(input.amountTiyin));
  url.searchParams.set('transaction_param', input.orderNumber);
  url.searchParams.set('return_url', input.returnUrl);
  return url.toString();
}

export class ClickPaymentProvider implements PaymentProvider {
  readonly key = 'click' as const;

  constructor(private readonly credentials: Record<string, string>) {}

  async createCheckoutUrl(input: CheckoutInput): Promise<string> {
    const { serviceId, merchantId } = this.credentials;
    if (!serviceId || !merchantId) throw new Error('click serviceId/merchantId missing');
    return clickCheckoutUrl({
      serviceId,
      merchantId,
      orderNumber: input.orderNumber,
      amountTiyin: input.amountTiyin,
      returnUrl: input.returnUrl,
    });
  }
}
