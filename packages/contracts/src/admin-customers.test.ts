import { describe, expect, it } from 'vitest';
import { csvCell } from './admin-customers';
import { customerListQuerySchema, customerTagsSchema } from './schemas/admin-customers';

describe('csvCell', () => {
  it('quotes separators and neutralises formulas', () => {
    expect(csvCell('Dilnoza')).toBe('Dilnoza');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+998901234567')).toBe("'+998901234567");
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });
});

describe('customer list query', () => {
  it('treats blank URL params as unset and coerces numbers', () => {
    const q = customerListQuerySchema.parse({ region: '', q: '  ', ltvMin: '100000', ltvMax: '' });
    expect(q).toMatchObject({ segment: 'all', sort: 'activity', limit: 25, ltvMin: 100000 });
    expect(q.region).toBeUndefined();
    expect(q.q).toBeUndefined();
    expect(q.ltvMax).toBeUndefined();
  });

  it('falls back to defaults for unknown segment/sort', () => {
    expect(customerListQuerySchema.parse({ segment: 'vip', sort: 'x' })).toMatchObject({
      segment: 'all',
      sort: 'activity',
    });
  });
});

describe('customer tags', () => {
  it('normalises and dedupes', () => {
    expect(customerTagsSchema.parse({ tags: ['#Divan', 'divan', 'sharh_yozgan'] }).tags).toEqual([
      'divan',
      'sharh_yozgan',
    ]);
  });
  it('rejects spaces and long tags', () => {
    expect(customerTagsSchema.safeParse({ tags: ['two words'] }).success).toBe(false);
    expect(customerTagsSchema.safeParse({ tags: ['x'.repeat(33)] }).success).toBe(false);
  });
});
