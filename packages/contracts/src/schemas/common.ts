import { z } from 'zod';
import { parseUzPhone } from '../phone';

/** Accepts any user formatting, outputs E.164. Error codes map to localized messages. */
export const uzPhoneSchema = z.string().transform((value, ctx) => {
  const r = parseUzPhone(value);
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: r.error });
    return z.NEVER;
  }
  return r.e164;
});

export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export const idSchema = z.string().min(1).max(64);
