import { z } from 'zod';

/**
 * Simple structured rich text for CMS pages (legal, articles, FAQ). Rendered by web without
 * dangerouslySetInnerHTML. Text may contain `{store.*}` variables resolved from settings;
 * blocks whose variables are unresolved are hidden (never render `[placeholder]`).
 */
export const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('h2'), text: z.string() }),
  z.object({ type: z.literal('h3'), text: z.string() }),
  z.object({ type: z.literal('p'), text: z.string() }),
  z.object({
    type: z.literal('list'),
    ordered: z.boolean().default(false),
    items: z.array(z.string()),
  }),
  z.object({
    type: z.literal('dl'),
    items: z.array(z.object({ term: z.string(), desc: z.string() })),
  }),
  z.object({
    type: z.literal('table'),
    head: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
  z.object({
    type: z.literal('note'),
    tone: z.enum(['info', 'warn']).default('info'),
    text: z.string(),
  }),
  z.object({ type: z.literal('faq'), items: z.array(z.object({ q: z.string(), a: z.string() })) }),
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const contentBodySchema = z.array(contentBlockSchema);

export const PAGE_KINDS = ['LEGAL', 'ARTICLE', 'VIDEO', 'FAQ', 'HOME_BLOCK'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const LEGAL_SLUGS = ['oferta', 'maxfiylik', 'qaytarish', 'yetkazish-tolov'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

const VAR = /\{([a-zA-Z0-9_.]+)\}/g;

/** Replaces `{path}` variables; returns null if any variable is missing (caller hides the text). */
export function fillTemplate(
  text: string,
  vars: Record<string, string | number | null | undefined>,
): string | null {
  let missing = false;
  const out = text.replace(VAR, (_, key: string) => {
    const v = vars[key];
    if (v === null || v === undefined || v === '') {
      missing = true;
      return '';
    }
    return String(v);
  });
  return missing ? null : out;
}
