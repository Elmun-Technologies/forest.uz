import { z } from 'zod';
import { LOCALES } from '../locale';

export const localeSchema = z.enum(LOCALES);

/** Localized text stored as JSON `{ uz, ru }`. Both keys optional at rest; uz is the source copy. */
export const localizedSchema = z.object({
  uz: z.string(),
  ru: z.string().optional().default(''),
});

export const localizedRequiredSchema = z.object({ uz: z.string().min(1), ru: z.string().min(1) });
