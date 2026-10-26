import { normalizeSearch } from '@forest/contracts';

/**
 * Function words (normalized: RU «для/и/на», UZ «uchun/va/bilan») carry no product signal and
 * only add trigram noise ("kraska dlya divana" → kraska, divana).
 */
const STOPWORDS = new Set([
  'dlya',
  'i',
  'na',
  's',
  'v',
  'po',
  'za',
  'iz',
  'uchun',
  'va',
  'bilan',
  'ham',
]);

export interface WeightedTerm {
  term: string;
  weight: number;
}

/** Distinct meaningful tokens of an already normalized query. */
export function queryTokens(normalized: string): string[] {
  return [...new Set(normalized.split(' ').filter((w) => w.length >= 2 && !STOPWORDS.has(w)))];
}

/**
 * Terms for the trigram query: the whole phrase (exact multi-word synonyms like
 * "kraska dlya divana" score highest), each token, then dictionary synonyms (weaker).
 */
export function buildSearchTerms(
  normalized: string,
  synonyms: ReadonlyMap<string, readonly string[]>,
): WeightedTerm[] {
  const out = new Map<string, number>();
  const add = (term: string, weight: number) => {
    const n = normalizeSearch(term);
    if (n.length >= 2 && (out.get(n) ?? 0) < weight) out.set(n, weight);
  };
  const tokens = queryTokens(normalized);
  if (tokens.length > 1) add(normalized, 1.5);
  for (const tok of tokens) add(tok, 1);
  for (const key of [normalized, ...tokens])
    for (const syn of synonyms.get(key) ?? []) add(syn, 0.6);
  return [...out].map(([term, weight]) => ({ term, weight }));
}
