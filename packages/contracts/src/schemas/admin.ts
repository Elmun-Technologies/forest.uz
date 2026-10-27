import { z } from 'zod';
import { PERMISSIONS, STAFF_PASSWORD_MAX, STAFF_ROLES } from '../admin';
import { uzPhoneSchema } from './common';

/** Admin auth & staff inputs (`/v1/admin/*`). Types and DTOs live in the zod-free `admin.ts`. */

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const staffRoleSchema = z.enum(STAFF_ROLES);
export const permissionSchema = z.enum(PERMISSIONS);

export const adminLoginSchema = z.object({
  email,
  // Length-capped so argon2 never hashes megabytes; strength rules apply only when setting one.
  password: z.string().min(1).max(STAFF_PASSWORD_MAX),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const totpCodeSchema = z.object({
  code: z
    .string()
    .transform((v) => v.replace(/\s/g, ''))
    .pipe(z.string().regex(/^\d{6}$/)),
});
export type TotpCodeInput = z.infer<typeof totpCodeSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().regex(/^[\w-]{20,128}$/),
  password: z.string().min(1).max(STAFF_PASSWORD_MAX),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const staffInviteSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email,
  role: staffRoleSchema,
  phone: z
    .union([uzPhoneSchema, z.literal('').transform(() => null)])
    .nullable()
    .optional(),
});
export type StaffInviteInput = z.infer<typeof staffInviteSchema>;

export const staffUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    role: staffRoleSchema,
    active: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { path: ['role'] });
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const auditQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  entity: z.string().trim().max(64).optional(),
  action: z.string().trim().max(64).optional(),
  staffId: z.string().trim().max(64).optional(),
  /** Tashkent calendar days, inclusive. */
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const devAdminTotpSchema = z.object({ email });
