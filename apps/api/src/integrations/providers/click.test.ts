import { createHash } from 'node:crypto';
import {
  buildClickOfdPayload,
  clickAmountToTiyin,
  clickCheckoutUrl,
  clickCommissionInfo,
  clickMerchantAuth,
  clickMerchantId,
  type ClickRequest,
  clickSignString,
  isClickSignValid,
  parseClickRequest,
  tiyinToClickAmount,
} from './click';

const prepare: ClickRequest = {
  click_trans_id: '1111',
  service_id: '2222',
  click_paydoc_id: '3333',
  merchant_trans_id: 'F-10001',
  amount: '1000.00',
  action: '0',
  error: '0',
  error_note: 'Success',
  sign_time: '2026-10-26 12:00:00',
  sign_string: 'e226be03e13cfe848e73578576cbc762',
};

describe('click helpers', () => {
  it('signs exactly like the official library (vectors computed independently)', () => {
    expect(clickSignString(prepare, 'AAAAAAAA')).toBe('e226be03e13cfe848e73578576cbc762');
    const complete = {
      ...prepare,
      action: '1',
      merchant_prepare_id: '10001',
      sign_string: 'd3c9b074b68e7399598f62a65a8a2c05',
    };
    expect(clickSignString(complete, 'AAAAAAAA')).toBe('d3c9b074b68e7399598f62a65a8a2c05');
    expect(isClickSignValid(complete, 'AAAAAAAA')).toBe(true);
    expect(
      isClickSignValid(
        { ...complete, sign_string: complete.sign_string.toUpperCase() },
        'AAAAAAAA',
      ),
    ).toBe(true);
    expect(isClickSignValid({ ...complete, amount: '1000.01' }, 'AAAAAAAA')).toBe(false);
    expect(isClickSignValid(complete, 'BBBBBBBB')).toBe(false);
    expect(isClickSignValid({ ...complete, sign_string: 'short' }, 'AAAAAAAA')).toBe(false);
  });

  it('requires every field, and merchant_prepare_id for complete', () => {
    expect(parseClickRequest({ ...prepare })).toEqual(prepare);
    const { sign_time: _omit, ...missing } = prepare;
    expect(parseClickRequest(missing)).toBeNull();
    expect(parseClickRequest({ ...prepare, action: '1' })).toBeNull();
    expect(
      parseClickRequest({ ...prepare, action: '1', merchant_prepare_id: '10001' }),
    ).toMatchObject({
      merchant_prepare_id: '10001',
    });
    expect(parseClickRequest('nope')).toBeNull();
  });

  it("converts so'm decimals to tiyin exactly at the boundary", () => {
    expect(clickAmountToTiyin('520200')).toBe(52_020_000n);
    expect(clickAmountToTiyin('520200.00')).toBe(52_020_000n);
    expect(clickAmountToTiyin('520200.5')).toBe(52_020_050n);
    expect(clickAmountToTiyin('0.01')).toBe(1n);
    expect(clickAmountToTiyin('1e5')).toBeNull();
    expect(clickAmountToTiyin('-5')).toBeNull();
    expect(clickAmountToTiyin('5.001')).toBeNull();
    expect(tiyinToClickAmount(52_020_000n)).toBe('520200');
    expect(tiyinToClickAmount(52_020_050n)).toBe('520200.50');
  });

  it('derives the integer merchant id from the order number', () => {
    expect(clickMerchantId('F-10482')).toBe(10482);
    expect(clickMerchantId('weird')).toBe(0);
  });

  it('builds the hosted payment link', () => {
    const url = new URL(
      clickCheckoutUrl({
        serviceId: '2222',
        merchantId: '1111',
        orderNumber: 'F-10001',
        amountTiyin: 52_020_000n,
        returnUrl: 'https://forest.uz/uz/buyurtma/abc',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://my.click.uz/services/pay');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      service_id: '2222',
      merchant_id: '1111',
      amount: '520200',
      transaction_param: 'F-10001',
      return_url: 'https://forest.uz/uz/buyurtma/abc',
    });
  });
});

describe('click fiscalization (Merchant API ofd_data)', () => {
  const line = {
    title: 'Forest Chalk Wax, 1 l',
    ikpu: '03208001001000000',
    packageCode: '1501498',
    vatPercent: 12,
    qty: 2,
    unitPriceTiyin: 32_900_000n,
    discountTiyin: 6_580_000n,
  };
  const shipping = {
    title: 'Yetkazib berish xizmati',
    ikpu: '10112001001000000',
    packageCode: '1545437',
    vatPercent: 12,
    priceTiyin: 3_000_000n,
  };
  const base = {
    serviceId: '2222',
    paydocId: '3333',
    lines: [line],
    shipping,
    totalTiyin: 65_800_000n - 6_580_000n + 3_000_000n,
    sellerTaxId: '301234567',
  };

  it('signs Auth as merchant_user_id:sha1(timestamp + secret):timestamp', () => {
    const digest = createHash('sha1').update('1700000000secret').digest('hex');
    expect(clickMerchantAuth('42', 'secret', 1_700_000_000.9)).toBe(`42:${digest}:1700000000`);
  });

  it('identifies the seller by STIR (9 digits) or PINFL (14 digits)', () => {
    expect(clickCommissionInfo('301 234 567')).toEqual({ TIN: '301234567' });
    expect(clickCommissionInfo('12345678901234')).toEqual({ PINFL: '12345678901234' });
    expect(clickCommissionInfo('12345')).toBeNull();
    expect(clickCommissionInfo(null)).toBeNull();
  });

  it('builds one item per line plus delivery, with VAT inside the discounted amount', () => {
    const built = buildClickOfdPayload(base);
    expect(built).toEqual({
      payload: {
        service_id: 2222,
        payment_id: 3333,
        items: [
          {
            Name: 'Forest Chalk Wax, 1 l',
            SPIC: '03208001001000000',
            PackageCode: '1501498',
            GoodPrice: 32_900_000,
            Price: 65_800_000,
            Amount: 2,
            // 59 220 000 × 12 / 112 = 6 345 000 (rounded to the tiyin)
            VAT: 6_345_000,
            VATPercent: 12,
            Discount: 6_580_000,
            CommissionInfo: { TIN: '301234567' },
          },
          {
            Name: 'Yetkazib berish xizmati',
            SPIC: '10112001001000000',
            PackageCode: '1545437',
            GoodPrice: 3_000_000,
            Price: 3_000_000,
            Amount: 1,
            VAT: 321_429,
            VATPercent: 12,
            Discount: 0,
            CommissionInfo: { TIN: '301234567' },
          },
        ],
        received_ecash: 0,
        received_cash: 0,
        received_card: 62_220_000,
      },
    });
  });

  it('explains instead of building an incomplete receipt', () => {
    expect(buildClickOfdPayload({ ...base, sellerTaxId: '' })).toEqual({
      problem: 'seller TIN/PINFL missing (store legal data)',
    });
    expect(buildClickOfdPayload({ ...base, lines: [{ ...line, packageCode: null }] })).toEqual({
      problem: '1 line(s) without a package code',
    });
    expect(buildClickOfdPayload({ ...base, shipping: { ...shipping, ikpu: '' } })).toEqual({
      problem: 'delivery: 1 line(s) without a valid IKPU',
    });
    expect(buildClickOfdPayload({ ...base, totalTiyin: 1n })).toEqual({
      problem: "receipt lines don't add up to the payment",
    });
    expect(buildClickOfdPayload({ ...base, paydocId: '' })).toEqual({
      problem: 'Click service id / payment id missing',
    });
    // Free delivery: no delivery line, delivery codes not needed.
    const free = buildClickOfdPayload({
      ...base,
      shipping: { ...shipping, ikpu: '', priceTiyin: 0n },
      totalTiyin: 59_220_000n,
    });
    expect('payload' in free && free.payload.items).toHaveLength(1);
  });
});
