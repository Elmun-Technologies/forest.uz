import { describe, expect, it } from 'vitest';
import { ADMIN_TAB_STATUSES, refundableSoum, SLA_OPEN_STATUSES } from './admin-orders';
import { adminManualOrderSchema, adminOrderQuerySchema } from './schemas/admin-orders';

describe('admin orders contracts', () => {
  it('refundable amount never goes negative', () => {
    expect(refundableSoum({ amountSoum: 500_000, refundedSoum: 120_000 })).toBe(380_000);
    expect(refundableSoum({ amountSoum: 100, refundedSoum: 150 })).toBe(0);
  });

  it('SLA runs while fulfilment is open, never on closed orders', () => {
    expect(SLA_OPEN_STATUSES).toEqual(['CONFIRMED', 'PACKING', 'READY', 'HANDED_TO_COURIER']);
    expect(ADMIN_TAB_STATUSES.delivered).not.toContain('HANDED_TO_COURIER');
  });

  it('list query: empty filters mean none, defaults apply', () => {
    const q = adminOrderQuerySchema.parse({ carrier: '', tab: '', limit: '10' });
    expect(q).toMatchObject({ tab: 'all', sort: 'created_desc', limit: 10 });
    expect(q.carrier).toBeUndefined();
    expect(adminOrderQuerySchema.safeParse({ tab: 'nope' }).success).toBe(false);
  });

  it('manual order: E.164 phone, unique lines', () => {
    const base = {
      name: 'Dilnoza',
      phone: '90 123 45 67',
      region: 'tashkent_city',
      addressLine: 'Amir Temur 15-uy',
      zoneKey: 'tashkent-city-yandex',
      lines: [{ variantId: 'v1', qty: 2 }],
    };
    expect(adminManualOrderSchema.parse(base).phone).toBe('+998901234567');
    const dup = { ...base, lines: [base.lines[0], base.lines[0]] };
    expect(adminManualOrderSchema.safeParse(dup).success).toBe(false);
  });
});
