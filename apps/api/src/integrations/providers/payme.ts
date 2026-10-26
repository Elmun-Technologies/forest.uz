import { createHash, timingSafeEqual } from 'node:crypto';
import type { CheckoutInput, PaymentProvider } from './types';

/**
 * Payme Merchant API helpers (we are the JSON-RPC server, Payme is the client).
 * Source of truth: PaycomUZ/paycom-integration-php-template@889053c (see docs/runbooks/payments.md).
 * Anything not in that template (checkout URL format, receipt `detail`) is marked UNVERIFIED and
 * listed in docs/13-open-questions.md.
 */

/** Template `Transaction::TIMEOUT`: a created (state 1) transaction expires after 12 h. */
export const PAYME_TIMEOUT_MS = 43_200_000;

/** Template `Transaction::STATE_*`. */
export const PaymeState = {
  CREATED: 1,
  PERFORMED: 2,
  CANCELLED: -1,
  CANCELLED_AFTER_PERFORM: -2,
} as const;
export type PaymeStateCode = (typeof PaymeState)[keyof typeof PaymeState];

/** Template `Transaction::REASON_*`. */
export const PaymeReason = {
  RECEIVERS_NOT_FOUND: 1,
  PROCESSING_EXECUTION_FAILED: 2,
  EXECUTION_FAILED: 3,
  CANCELLED_BY_TIMEOUT: 4,
  FUND_RETURNED: 5,
  UNKNOWN: 10,
} as const;

/** Template `PaycomException::ERROR_*`. */
export const PaymeError = {
  INTERNAL_SYSTEM: -32400,
  INSUFFICIENT_PRIVILEGE: -32504,
  INVALID_JSON_RPC_OBJECT: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  COULD_NOT_CANCEL: -31007,
  COULD_NOT_PERFORM: -31008,
  INVALID_ACCOUNT: -31050,
} as const;

/** Payme shows `message` to the payer in their language (template `PaycomException::message`). */
export interface PaymeMessage {
  ru: string;
  uz: string;
  en: string;
}

/**
 * Body that isn't JSON never reaches the controller (the body parser rejects it), so the
 * exception filter answers with this JSON-RPC parse error (-32700, JSON-RPC 2.0 spec).
 */
export function paymeParseErrorResponse() {
  return {
    jsonrpc: '2.0' as const,
    id: null,
    result: null,
    error: {
      code: -32700,
      message: {
        ru: 'Ошибка разбора JSON.',
        uz: 'JSON tahlilida xatolik.',
        en: 'Parse error.',
      },
    },
  };
}

/** Account field name configured in the Payme cashbox ("Поля счёта"). Value = Order.number. */
export const PAYME_ACCOUNT_FIELD = 'order_id';

/** The login in the Basic auth header is always `Paycom` (template config `login`). */
export const PAYME_LOGIN = 'Paycom';

/**
 * Key Payme uses for the Basic auth password: the test key while the cashbox is in test mode
 * (sandbox), the production key otherwise.
 */
export function paymeAuthKey(credentials: Record<string, string>): string | null {
  if (credentials.mode === 'test' && credentials.testKey) return credentials.testKey;
  return credentials.key || null;
}

/** Which credential field `ChangePassword` must overwrite (the one currently used for auth). */
export function paymeKeyField(credentials: Record<string, string>): 'key' | 'testKey' {
  return credentials.mode === 'test' && credentials.testKey ? 'testKey' : 'key';
}

function sameSecret(a: string, b: string): boolean {
  // Hash first so the comparison is constant-time regardless of length.
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

/** Template `Merchant::Authorize`: `Authorization: Basic base64("Paycom:<key>")`. */
export function isPaymeAuthorized(header: string | undefined, key: string | null): boolean {
  if (!header || !key) return false;
  const m = /^\s*Basic\s+(\S+)\s*$/i.exec(header);
  if (!m?.[1]) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  return sameSecret(decoded, `${PAYME_LOGIN}:${key}`);
}

/** Template `Transaction::isExpired`: only a created transaction can expire. */
export function isPaymeTxnExpired(state: number, createTimeMs: number, nowMs: number): boolean {
  return state === PaymeState.CREATED && Math.abs(nowMs - createTimeMs) > PAYME_TIMEOUT_MS;
}

/**
 * CreateTransaction for a new id: Payme's own `time` must be within the timeout. The template
 * compares `time - now >= TIMEOUT` (a sign slip — it can never trigger for past times); we apply
 * the intended "older than 12 h" check.
 */
export function isPaymeCreateTimeTooOld(paymeTimeMs: number, nowMs: number): boolean {
  return nowMs - paymeTimeMs >= PAYME_TIMEOUT_MS;
}

export function paymeCheckoutHost(mode: string | undefined): string {
  // UNVERIFIED (docs/06 + template README "Merchant Sandbox http://test.paycom.uz"): test host.
  return mode === 'test' ? 'https://test.paycom.uz' : 'https://checkout.paycom.uz';
}

/**
 * Hosted checkout link, GET form: `<host>/<base64("m=…;ac.order_id=…;a=…;c=…;l=…")>`.
 * UNVERIFIED: the parameter format comes from docs/06, not from an official repo.
 */
export function paymeCheckoutUrl(input: {
  merchantId: string;
  orderNumber: string;
  amountTiyin: bigint;
  returnUrl: string;
  locale: 'uz' | 'ru';
  mode: string | undefined;
}): string {
  const params = [
    `m=${input.merchantId}`,
    `ac.${PAYME_ACCOUNT_FIELD}=${input.orderNumber}`,
    `a=${input.amountTiyin.toString()}`,
    `c=${input.returnUrl}`,
    `l=${input.locale}`,
  ].join(';');
  return `${paymeCheckoutHost(input.mode)}/${Buffer.from(params, 'utf8').toString('base64')}`;
}

export class PaymePaymentProvider implements PaymentProvider {
  readonly key = 'payme' as const;

  constructor(private readonly credentials: Record<string, string>) {}

  async createCheckoutUrl(input: CheckoutInput): Promise<string> {
    const merchantId = this.credentials.merchantId;
    if (!merchantId) throw new Error('payme merchantId missing');
    return paymeCheckoutUrl({
      merchantId,
      orderNumber: input.orderNumber,
      amountTiyin: input.amountTiyin,
      returnUrl: input.returnUrl,
      locale: input.locale,
      mode: this.credentials.mode,
    });
  }
}

// ── Fiscal receipt detail (UNVERIFIED field names) ──

export interface ReceiptLineInput {
  title: string;
  ikpu: string;
  packageCode: string | null;
  vatPercent: number;
  qty: number;
  unitPriceTiyin: bigint;
  /** Discount for the whole line (all units), tiyin. */
  discountTiyin: bigint;
}

export interface PaymeReceiptDetail {
  receipt_type: 0;
  items: {
    title: string;
    price: number;
    count: number;
    code: string;
    package_code: string | null;
    vat_percent: number;
    discount: number;
  }[];
  shipping?: { title: string; price: number };
}

/**
 * Fiscal data for Payme's receipt (`detail` in the CheckPerformTransaction result).
 * UNVERIFIED: the official template has no `detail`; field names follow docs/06
 * (`title, price, count, code, package_code, vat_percent` + shipping) plus `receipt_type` and
 * `discount` as published in Payme's fiscalization docs we could not reach. Kept in one function
 * so it can be corrected in one place; can be switched off per cashbox (`fiscalDetail=off`).
 * Returns null when the lines don't add up to the order total — sending an inconsistent receipt
 * would be worse than none (the payment itself still goes through).
 */
export function buildPaymeReceiptDetail(
  lines: ReceiptLineInput[],
  shipping: { title: string; priceTiyin: bigint } | null,
  totalTiyin: bigint,
): PaymeReceiptDetail | null {
  const items = lines.map((l) => ({
    title: l.title.slice(0, 128),
    price: Number(l.unitPriceTiyin),
    count: l.qty,
    code: l.ikpu,
    package_code: l.packageCode,
    vat_percent: l.vatPercent,
    discount: Number(l.discountTiyin),
  }));
  const linesTotal = lines.reduce(
    (sum, l) => sum + l.unitPriceTiyin * BigInt(l.qty) - l.discountTiyin,
    0n,
  );
  const shippingTiyin = shipping && shipping.priceTiyin > 0n ? shipping.priceTiyin : 0n;
  if (linesTotal + shippingTiyin !== totalTiyin) return null;
  return {
    receipt_type: 0,
    items,
    ...(shipping && shippingTiyin > 0n
      ? { shipping: { title: shipping.title, price: Number(shippingTiyin) } }
      : {}),
  };
}
