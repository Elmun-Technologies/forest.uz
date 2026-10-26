import {
  buildPaymeReceiptDetail,
  isPaymeAuthorized,
  isPaymeCreateTimeTooOld,
  isPaymeTxnExpired,
  PAYME_TIMEOUT_MS,
  paymeAuthKey,
  paymeCheckoutUrl,
  paymeKeyField,
  PaymeState,
} from './payme';

describe('payme helpers', () => {
  it('checks Basic auth "Paycom:<key>" exactly', () => {
    expect(isPaymeAuthorized('Basic UGF5Y29tOnNlY3JldC1rZXk=', 'secret-key')).toBe(true);
    expect(isPaymeAuthorized('  basic   UGF5Y29tOnNlY3JldC1rZXk=  ', 'secret-key')).toBe(true);
    expect(isPaymeAuthorized('Basic UGF5Y29tOnNlY3JldC1rZXk=', 'other-key')).toBe(false);
    const wrongLogin = Buffer.from('Payme:secret-key').toString('base64');
    expect(isPaymeAuthorized(`Basic ${wrongLogin}`, 'secret-key')).toBe(false);
    expect(isPaymeAuthorized('Bearer UGF5Y29tOnNlY3JldC1rZXk=', 'secret-key')).toBe(false);
    expect(isPaymeAuthorized(undefined, 'secret-key')).toBe(false);
    expect(isPaymeAuthorized('Basic UGF5Y29tOg==', null)).toBe(false);
  });

  it('uses the test key only in test mode', () => {
    expect(paymeAuthKey({ mode: 'test', key: 'live', testKey: 'test' })).toBe('test');
    expect(paymeAuthKey({ mode: 'live', key: 'live', testKey: 'test' })).toBe('live');
    expect(paymeAuthKey({ mode: 'test', key: 'live' })).toBe('live');
    expect(paymeAuthKey({ mode: 'live' })).toBeNull();
    expect(paymeKeyField({ mode: 'test', key: 'a', testKey: 'b' })).toBe('testKey');
    expect(paymeKeyField({ mode: 'live', key: 'a', testKey: 'b' })).toBe('key');
  });

  it('expires only created transactions older than 12 h (fixed clock)', () => {
    const created = Date.UTC(2026, 9, 26, 7, 0, 0);
    expect(PAYME_TIMEOUT_MS).toBe(12 * 3600 * 1000);
    expect(isPaymeTxnExpired(PaymeState.CREATED, created, created + PAYME_TIMEOUT_MS)).toBe(false);
    expect(isPaymeTxnExpired(PaymeState.CREATED, created, created + PAYME_TIMEOUT_MS + 1)).toBe(
      true,
    );
    expect(isPaymeTxnExpired(PaymeState.PERFORMED, created, created + 2 * PAYME_TIMEOUT_MS)).toBe(
      false,
    );
    expect(isPaymeCreateTimeTooOld(created, created + PAYME_TIMEOUT_MS - 1)).toBe(false);
    expect(isPaymeCreateTimeTooOld(created, created + PAYME_TIMEOUT_MS)).toBe(true);
    expect(isPaymeCreateTimeTooOld(created + 5_000, created)).toBe(false);
  });

  it('builds the checkout URL for live and test hosts', () => {
    const input = {
      merchantId: '587f72c72cac0d162c722ae2',
      orderNumber: 'F-10001',
      amountTiyin: 52_020_000n,
      returnUrl: 'https://forest.uz/uz/buyurtma/abc',
      locale: 'uz' as const,
    };
    const encoded =
      'bT01ODdmNzJjNzJjYWMwZDE2MmM3MjJhZTI7YWMub3JkZXJfaWQ9Ri0xMDAwMTthPTUyMDIwMDAwO2M9aHR0cHM6Ly9mb3Jlc3QudXovdXovYnV5dXJ0bWEvYWJjO2w9dXo=';
    expect(paymeCheckoutUrl({ ...input, mode: 'live' })).toBe(
      `https://checkout.paycom.uz/${encoded}`,
    );
    expect(paymeCheckoutUrl({ ...input, mode: 'test' })).toBe(`https://test.paycom.uz/${encoded}`);
  });

  it('builds receipt detail from order lines + shipping and refuses inconsistent totals', () => {
    const lines = [
      {
        title: 'Forest Chalk Wax, 1 l',
        ikpu: '03208001001000000',
        packageCode: '1501498',
        vatPercent: 12,
        qty: 2,
        unitPriceTiyin: 32_900_000n,
        discountTiyin: 6_580_000n,
      },
      {
        title: 'Cho‘tka',
        ikpu: '09603001001000000',
        packageCode: null,
        vatPercent: 12,
        qty: 1,
        unitPriceTiyin: 11_900_000n,
        discountTiyin: 0n,
      },
    ];
    const detail = buildPaymeReceiptDetail(
      lines,
      { title: 'Yetkazib berish', priceTiyin: 3_000_000n },
      65_800_000n - 6_580_000n + 11_900_000n + 3_000_000n,
    );
    expect(detail).toEqual({
      receipt_type: 0,
      items: [
        {
          title: 'Forest Chalk Wax, 1 l',
          price: 32_900_000,
          count: 2,
          code: '03208001001000000',
          package_code: '1501498',
          vat_percent: 12,
          discount: 6_580_000,
        },
        {
          title: 'Cho‘tka',
          price: 11_900_000,
          count: 1,
          code: '09603001001000000',
          package_code: null,
          vat_percent: 12,
          discount: 0,
        },
      ],
      shipping: { title: 'Yetkazib berish', price: 3_000_000 },
    });
    // Free delivery → no shipping line.
    expect(
      buildPaymeReceiptDetail(lines.slice(1), { title: 'x', priceTiyin: 0n }, 11_900_000n),
    ).not.toHaveProperty('shipping');
    expect(buildPaymeReceiptDetail(lines, null, 1n)).toBeNull();
  });
});
