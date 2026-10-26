import { maskPhonesInText, redact, REDACTED } from './redact';

describe('redact', () => {
  it('redacts sensitive keys recursively', () => {
    const out = redact({
      order: { id: 'o1', phone: '+998901234567', address: { line: 'x' } },
      headers: { Authorization: 'Basic abc' },
      items: [{ token: 't', sku: 'FR-CW' }],
      when: new Date(0),
    });
    expect(out.order.phone).toBe(REDACTED);
    expect(out.order.address).toBe(REDACTED);
    expect(out.headers.Authorization).toBe(REDACTED);
    expect(out.items[0]?.token).toBe(REDACTED);
    expect(out.items[0]?.sku).toBe('FR-CW');
    expect(out.when).toBeInstanceOf(Date);
  });

  it('masks phones inside free text', () => {
    expect(maskPhonesInText('call +998 90 123 45 67 now')).toBe('call +998 90 *** ** 67 now');
    expect(maskPhonesInText('998901234567')).toBe('+998 90 *** ** 67');
  });

  it('stops at excessive depth', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 12; i++) deep = deep.n = {};
    expect(JSON.stringify(redact(root))).toContain(REDACTED);
  });
});
