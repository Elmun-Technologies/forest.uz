/**
 * Text normalization for slugs and search. Uzbek Latin uses o' / g' with many apostrophe
 * variants (ʻ ’ ‘ ` '), and shoppers type in Latin, Uzbek Cyrillic and Russian interchangeably.
 */

const APOSTROPHES = /[ʻʼ‘’`´']/g;

// Uzbek Cyrillic + Russian → Latin (search key, not a linguistic transliteration).
const CYR_TO_LAT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ғ: "g'",
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  қ: 'q',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ў: "o'",
  ф: 'f',
  х: 'x',
  ҳ: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function cyrillicToLatin(input: string): string {
  let out = '';
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const mapped = CYR_TO_LAT[lower];
    out += mapped === undefined ? ch : mapped;
  }
  return out;
}

/** Lowercase, Latin-only, apostrophes removed, diacritics stripped, single spaces. */
export function normalizeSearch(input: string): string {
  return cyrillicToLatin(input.toLowerCase())
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(APOSTROPHES, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** URL slug: `Chalk White mebel bo'yog'i` → `chalk-white-mebel-boyogi`. */
export function slugify(input: string): string {
  return normalizeSearch(input).replace(/\s/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** Detects design placeholders like `[mijoz ismi]`, `[4,9]`, `[N]` that must never render publicly. */
export function containsPlaceholder(input: string): boolean {
  return /\[[^\]\n]{1,40}\]/.test(input);
}
