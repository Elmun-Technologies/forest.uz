import {
  clickAmountToTiyin,
  clickCheckoutUrl,
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
