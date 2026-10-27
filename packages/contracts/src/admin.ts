/**
 * Admin RBAC (docs/02 "Staff roles", CLAUDE.md §6). Zod-free: the admin UI imports it from
 * `@forest/contracts/core` to hide what a role can't use; the API enforces the same map.
 * Code checks permissions, never role names.
 */

export const STAFF_ROLES = ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE', 'MARKETER'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  'dashboard.view',
  'analytics.view',
  'analytics.import',
  'orders.view',
  'orders.edit',
  'orders.cancel_refund',
  'customers.view',
  'customers.pii',
  'customers.pii_partial',
  'customers.export',
  'customers.erase',
  'audiences.edit',
  'bot.inbox',
  'bot.edit',
  'products.view',
  'products.edit',
  'moysklad.sync',
  'moysklad.edit',
  'reviews.view',
  'reviews.moderate',
  'promo.edit',
  'seo.edit',
  'content.edit',
  'integrations.view',
  'integrations.keys',
  'settings.staff',
  'settings.store',
  'settings.delivery',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_ROLES = STAFF_ROLES;
const O = ['OWNER'] as const;
const OM = ['OWNER', 'MANAGER'] as const;
const OMOp = ['OWNER', 'MANAGER', 'OPERATOR'] as const;
const OMMk = ['OWNER', 'MANAGER', 'MARKETER'] as const;

/**
 * Who holds each permission. Rows marked docs/02 are the business-rules matrix verbatim; the rest
 * are least-privilege choices where the docs are silent (logged in CLAUDE.md §6).
 */
export const PERMISSION_ROLES: Record<Permission, readonly StaffRole[]> = {
  'dashboard.view': ALL_ROLES,
  'analytics.view': OMMk, // docs/02 "Analytics & heatmaps"
  'analytics.import': OMMk, // ad spend CSV/API import (docs/02 silent → analytics holders)
  'orders.view': ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE'], // docs/02 "View/edit orders"
  'orders.edit': ['OWNER', 'MANAGER', 'OPERATOR', 'WAREHOUSE'], // docs/02 "View/edit orders"
  'orders.cancel_refund': OM, // docs/02 "Cancel / refund"
  'customers.view': OMOp,
  'customers.pii': OMOp, // docs/02 "Customer phone & address"
  'customers.pii_partial': ['WAREHOUSE'], // docs/02: address on the packing slip only
  'customers.export': O, // docs/02 "Export customer database"
  'customers.erase': O,
  'audiences.edit': OMMk,
  'bot.inbox': OMOp,
  'bot.edit': OMMk,
  'products.view': ALL_ROLES,
  'products.edit': OMMk, // docs/02 "Product content, images, SEO"
  'moysklad.sync': ['OWNER', 'MANAGER', 'WAREHOUSE'],
  'moysklad.edit': OM,
  'reviews.view': ['OWNER', 'MANAGER', 'OPERATOR', 'MARKETER'],
  'reviews.moderate': OMMk,
  'promo.edit': OMMk, // docs/02 "Promo codes"
  'seo.edit': OMMk, // docs/02 "Product content, images, SEO"
  'content.edit': OMMk, // Ilhom/Brend CMS — docs/02 "Product content, images, SEO"
  'integrations.view': OM,
  'integrations.keys': O, // docs/02 "Integration keys"
  'settings.staff': O,
  'settings.store': O,
  'settings.delivery': OM,
  'audit.view': OM,
};

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  OWNER: permissionsOf('OWNER'),
  MANAGER: permissionsOf('MANAGER'),
  OPERATOR: permissionsOf('OPERATOR'),
  WAREHOUSE: permissionsOf('WAREHOUSE'),
  MARKETER: permissionsOf('MARKETER'),
};

function permissionsOf(role: StaffRole): Permission[] {
  return PERMISSIONS.filter((p) => PERMISSION_ROLES[p].includes(role));
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

export function hasPermission(role: StaffRole, permission: Permission): boolean {
  return PERMISSION_ROLES[permission].includes(role);
}

/** True when the role holds at least one of `permissions` (nav groups, combined pages). */
export function hasAnyPermission(role: StaffRole, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/** docs/02: TOTP is mandatory for Owner and Manager, recommended for the others. */
export const TOTP_REQUIRED_ROLES: readonly StaffRole[] = ['OWNER', 'MANAGER'];

export function totpRequired(role: StaffRole): boolean {
  return TOTP_REQUIRED_ROLES.includes(role);
}

/**
 * The docs/02 matrix rows as shown on A16 "Rollar va huquqlar": the permission that grants the
 * row (and the one that counts as "partial"). Labels live in the admin UI copy.
 */
export const RBAC_MATRIX_ROWS = [
  { key: 'orders', permission: 'orders.edit' },
  { key: 'cancelRefund', permission: 'orders.cancel_refund' },
  { key: 'customerPii', permission: 'customers.pii', partial: 'customers.pii_partial' },
  { key: 'customerExport', permission: 'customers.export' },
  { key: 'productContent', permission: 'products.edit' },
  { key: 'promo', permission: 'promo.edit' },
  { key: 'analytics', permission: 'analytics.view' },
  { key: 'integrationKeys', permission: 'integrations.keys' },
] as const satisfies readonly { key: string; permission: Permission; partial?: Permission }[];

export type RbacMatrixRowKey = (typeof RBAC_MATRIX_ROWS)[number]['key'];

export type MatrixCell = 'yes' | 'partial' | 'no';

export function matrixCell(
  row: { permission: Permission; partial?: Permission },
  role: StaffRole,
): MatrixCell {
  if (hasPermission(role, row.permission)) return 'yes';
  if (row.partial && hasPermission(role, row.partial)) return 'partial';
  return 'no';
}

// ───────────────────────── Passwords ─────────────────────────

export const STAFF_PASSWORD_MIN = 12;
export const STAFF_PASSWORD_MAX = 128;

/** Frequent picks that pass a length rule; checked case-insensitively, also as a substring. */
const COMMON_PASSWORDS = [
  'password',
  'parol',
  'qwerty',
  '123456',
  '1234567890',
  'admin',
  'forest',
  'letmein',
  'welcome',
  'iloveyou',
  'abc123',
  '111111',
  'tashkent',
  'toshkent',
];

export type PasswordProblem = 'too_short' | 'too_long' | 'contains_name' | 'too_common';

/**
 * Staff password rule (NIST 800-63B style: length over composition rules). Shared by the API and
 * the invite form, so the UI explains exactly what the server enforces.
 */
export function passwordProblems(
  password: string,
  context: { email?: string | null; name?: string | null } = {},
): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const length = [...password].length;
  if (length < STAFF_PASSWORD_MIN) problems.push('too_short');
  if (length > STAFF_PASSWORD_MAX) problems.push('too_long');
  const lower = password.toLowerCase();
  const personal = [context.email?.split('@')[0], ...(context.name?.split(/\s+/) ?? [])]
    .map((v) => v?.trim().toLowerCase() ?? '')
    .filter((v) => v.length >= 3);
  if (personal.some((p) => lower.includes(p))) problems.push('contains_name');
  const stripped = lower.replace(/[^a-z0-9]/g, '');
  const unique = new Set(lower).size;
  if (unique <= 3 || COMMON_PASSWORDS.some((c) => stripped.includes(c) && stripped.length < 16))
    problems.push('too_common');
  return problems;
}

// ───────────────────────── DTOs ─────────────────────────

/** Where an admin session stands: waiting for the TOTP code, forced enrolment, or full access. */
export type AdminStage = 'totp' | 'setup' | 'full';

export interface AdminMeDto {
  staff: { id: string; name: string; email: string; role: StaffRole };
  stage: AdminStage;
  /** Empty until the stage is `full`. */
  permissions: Permission[];
  totp: { enabled: boolean; required: boolean };
}

export interface TotpSetupDto {
  /** Base32 secret, shown once for manual entry. */
  secret: string;
  otpauthUri: string;
}

export interface StaffDto {
  id: string;
  name: string;
  email: string;
  /** Masked (`+998 90 *** ** 67`). */
  phone: string | null;
  role: StaffRole;
  active: boolean;
  totpEnabled: boolean;
  /** Pending invite (no password yet). */
  invitePending: boolean;
  inviteExpiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface StaffInviteResultDto {
  staff: StaffDto;
  /** One-time link; shown once, never stored in plain text. */
  inviteUrl: string;
  expiresAt: string;
}

export interface InviteInfoDto {
  name: string;
  email: string;
  role: StaffRole;
  totpRequired: boolean;
}

export interface AuditEntryDto {
  id: string;
  createdAt: string;
  staff: { id: string; name: string } | null;
  action: string;
  entity: string;
  entityId: string | null;
  /** Readable target (e.g. the staff member's name for `Staff` rows), when known. */
  entityLabel: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditPageDto {
  items: AuditEntryDto[];
  nextCursor: string | null;
}

export interface AuditActorDto {
  id: string;
  name: string;
}
