import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  hasAnyPermission,
  hasPermission,
  isPermission,
  isStaffRole,
  matrixCell,
  passwordProblems,
  PERMISSION_ROLES,
  PERMISSIONS,
  type Permission,
  RBAC_MATRIX_ROWS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  type StaffRole,
  totpRequired,
} from './admin';

const here = dirname(fileURLToPath(import.meta.url));
const businessRules = readFileSync(resolve(here, '../../../docs/02-business-rules.md'), 'utf8');

/** docs/02 "Staff roles (RBAC, A16)" table → { label: cells[Owner..Marketer] }. */
function docsMatrix(): Map<string, string[]> {
  const section = businessRules.split('## Staff roles')[1]!.split('\n## ')[0]!;
  const rows = section
    .split('\n')
    .filter((l) => l.startsWith('|') && !l.startsWith('|---') && !l.includes('Permission'));
  return new Map(
    rows.map((l) => {
      const cells = l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      return [cells[0]!, cells.slice(1)];
    }),
  );
}

const DOC_ROLES: StaffRole[] = ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'MARKETER'];

/** Which permissions encode each docs/02 row (a row may grant several). */
const DOC_ROWS: Record<string, { grants: Permission[]; partial?: Permission }> = {
  'View/edit orders': { grants: ['orders.view', 'orders.edit'] },
  'Cancel / refund': { grants: ['orders.cancel_refund'] },
  'Customer phone & address': { grants: ['customers.pii'], partial: 'customers.pii_partial' },
  'Export customer database': { grants: ['customers.export'] },
  'Product content, images, SEO': { grants: ['products.edit', 'seo.edit'] },
  'Promo codes': { grants: ['promo.edit'] },
  'Analytics & heatmaps': { grants: ['analytics.view'] },
  'Integration keys': { grants: ['integrations.keys'] },
};

describe('RBAC matrix vs docs/02', () => {
  const matrix = docsMatrix();

  it('covers every row of the docs table', () => {
    expect([...matrix.keys()].sort()).toEqual(Object.keys(DOC_ROWS).sort());
  });

  for (const [label, { grants, partial }] of Object.entries(DOC_ROWS)) {
    it(`row "${label}"`, () => {
      const cells = matrix.get(label)!;
      DOC_ROLES.forEach((role, i) => {
        const cell = cells[i]!;
        for (const p of grants) expect(hasPermission(role, p), `${role} ${p}`).toBe(cell === '✓');
        if (cell.startsWith('partial')) expect(partial && hasPermission(role, partial)).toBe(true);
        else if (partial) expect(hasPermission(role, partial), `${role} ${partial}`).toBe(false);
      });
    });
  }

  it('A16 matrix rows render the docs cells', () => {
    const toCell = (v: string) => (v === '✓' ? 'yes' : v.startsWith('partial') ? 'partial' : 'no');
    const labelOf = (permission: Permission) =>
      Object.entries(DOC_ROWS).find(([, r]) => r.grants.includes(permission))![0];
    expect(RBAC_MATRIX_ROWS).toHaveLength(Object.keys(DOC_ROWS).length);
    for (const row of RBAC_MATRIX_ROWS) {
      const label = labelOf(row.permission);
      DOC_ROLES.forEach((role, i) => {
        expect(matrixCell(row, role)).toBe(toCell(matrix.get(label)![i]!));
      });
    }
  });

  it('TOTP mandatory for Owner & Manager only', () => {
    expect(businessRules).toContain('2FA (TOTP) mandatory for Owner & Manager');
    expect(STAFF_ROLES.filter(totpRequired)).toEqual(['OWNER', 'MANAGER']);
  });
});

describe('permission model', () => {
  it('Owner holds everything except the Warehouse-only partial PII view', () => {
    expect(ROLE_PERMISSIONS.OWNER).toEqual(
      PERMISSIONS.filter((p) => p !== 'customers.pii_partial'),
    );
  });

  it('least-privilege choices where docs are silent', () => {
    expect(PERMISSION_ROLES['settings.staff']).toEqual(['OWNER']);
    expect(PERMISSION_ROLES['settings.store']).toEqual(['OWNER']);
    expect(PERMISSION_ROLES['customers.erase']).toEqual(['OWNER']);
    expect(PERMISSION_ROLES['audit.view']).toEqual(['OWNER', 'MANAGER']);
    expect(PERMISSION_ROLES['integrations.view']).toEqual(['OWNER', 'MANAGER']);
    expect(hasPermission('WAREHOUSE', 'customers.view')).toBe(false);
    expect(hasPermission('MARKETER', 'customers.view')).toBe(false);
    expect(hasPermission('OPERATOR', 'reviews.moderate')).toBe(false);
    expect(hasPermission('WAREHOUSE', 'moysklad.sync')).toBe(true);
    expect(hasPermission('WAREHOUSE', 'moysklad.edit')).toBe(false);
  });

  it('every role can open the dashboard and the catalogue', () => {
    for (const role of STAFF_ROLES) {
      expect(hasPermission(role, 'dashboard.view')).toBe(true);
      expect(hasPermission(role, 'products.view')).toBe(true);
    }
  });

  it('role map and permission map agree', () => {
    for (const role of STAFF_ROLES)
      for (const p of PERMISSIONS)
        expect(ROLE_PERMISSIONS[role].includes(p)).toBe(PERMISSION_ROLES[p].includes(role));
  });

  it('guards and helpers', () => {
    expect(isStaffRole('OWNER')).toBe(true);
    expect(isStaffRole('owner')).toBe(false);
    expect(isPermission('orders.view')).toBe(true);
    expect(isPermission('orders.delete')).toBe(false);
    expect(hasAnyPermission('MARKETER', ['orders.view', 'promo.edit'])).toBe(true);
    expect(hasAnyPermission('WAREHOUSE', ['promo.edit', 'seo.edit'])).toBe(false);
  });
});

describe('passwordProblems', () => {
  it('accepts a long passphrase', () => {
    expect(passwordProblems('qizil olma 2026 bahor', { email: 'madina@forest.uz' })).toEqual([]);
  });

  it('length bounds', () => {
    expect(passwordProblems('short1A!')).toContain('too_short');
    expect(passwordProblems('x'.repeat(10) + 'ab'.repeat(60))).toContain('too_long');
  });

  it('rejects the email name or the person name', () => {
    expect(passwordProblems('madina-2026-strong', { email: 'madina@forest.uz' })).toContain(
      'contains_name',
    );
    expect(passwordProblems('Sardorbek-uchun-kalit', { name: 'Sardorbek Aliyev' })).toContain(
      'contains_name',
    );
  });

  it('rejects common passwords and repeated characters', () => {
    expect(passwordProblems('Password1234')).toContain('too_common');
    expect(passwordProblems('forest123456')).toContain('too_common');
    expect(passwordProblems('aaaaaaaaaaaaaaa')).toContain('too_common');
    expect(passwordProblems('ababababababab')).toContain('too_common');
  });
});
