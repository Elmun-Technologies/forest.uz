/**
 * Prompts and output schemas for AI drafts (CLAUDE.md §6). Inputs are catalog/content facts only;
 * conversation text passes through `scrubPii` first. Pure module (unit-tested).
 */

const PHONE = /(?:\+?998[\s-]?)?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g;
const LONG_DIGITS = /\b\d[\d\s-]{8,}\d\b/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const IDS = /\b[FC]-\d{4,}\b/g;
const URL_RE = /https?:\/\/\S+/g;

/** Masks phone numbers, card/long digit runs, emails, order/customer ids and links. */
export function scrubPii(text: string): string {
  return text
    .replace(URL_RE, '[link]')
    .replace(EMAIL, '[email]')
    .replace(IDS, '[id]')
    .replace(PHONE, '[phone]')
    .replace(LONG_DIGITS, '[number]');
}

const strict = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const str = { type: 'string' };
const pair = strict({ uz: str, ru: str });

export const PRODUCT_SCHEMA = strict({ shortDesc: pair, description: pair });
export const SEO_SCHEMA = strict({
  uz: strict({ title: str, description: str }),
  ru: strict({ title: str, description: str }),
});
export const REPLY_SCHEMA = strict({ text: str });

const VOICE =
  'You write for Forest, an online shop in Uzbekistan selling European water-based furniture and ' +
  'fabric paints, kits and accessories. Uzbek text is in the Latin alphabet with correct ' +
  "apostrophes (o', g'); Russian is natural, professional, not a literal translation. " +
  'Use only facts given in the request. Never invent certifications, awards, prices, discounts, ' +
  'ratings, delivery promises or health claims. No markdown, no emoji, no placeholders.';

export const PRODUCT_SYSTEM =
  `${VOICE} Task: draft product copy. shortDesc: one or two sentences, at most 300 characters. ` +
  'description: 2-4 short paragraphs separated by a blank line, 400-1500 characters, covering ' +
  'what it is for, how it is used and what result to expect, based on the facts.';

export const SEO_SYSTEM =
  `${VOICE} Task: draft a search result title and meta description for one page, in both ` +
  'languages. title: at most 60 characters, ends with "| Forest". description: 120-160 ' +
  'characters, one or two sentences with the main benefit and a soft call to action.';

export const REPLY_SYSTEM =
  `${VOICE} Task: draft the next reply of a human shop operator in a Telegram chat with a ` +
  'customer. Be polite, brief (at most 600 characters) and helpful; answer only what the ' +
  "facts allow, otherwise say the operator will check and get back. Don't ask for card data. " +
  'Write in the requested language. Masked parts like [phone] stay masked.';

export function factsBlock(facts: Record<string, unknown>): string {
  const lines = Object.entries(facts)
    .filter(
      ([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length),
    )
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return lines.join('\n');
}

/** Trims to `max` characters on a word boundary. */
export function clip(text: unknown, max: number): string {
  const s = typeof text === 'string' ? text.replace(/\r/g, '').trim() : '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}
