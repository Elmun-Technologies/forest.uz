import { z } from 'zod';

/**
 * Admin A10 credentials input. Values are free text checked against the registry's field list
 * server-side; a blank value keeps the stored one (CLAUDE.md §6).
 */
export const integrationCredentialsSchema = z.object({
  fields: z
    .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.string().max(8000))
    .refine((v) => Object.keys(v).length <= 40),
});
export type IntegrationCredentialsInput = z.infer<typeof integrationCredentialsSchema>;

/** Typed confirmation for disconnect: the integration key. */
export const integrationDisconnectSchema = z.object({ confirm: z.string().trim().max(64) });
export type IntegrationDisconnectInput = z.infer<typeof integrationDisconnectSchema>;
