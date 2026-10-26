import { normalizeSearch } from '@forest/contracts';
import { buildSearchTerms, queryTokens } from './search-terms';

const synonyms = new Map<string, string[]>([
  ['kraska', ['boyoq', 'paint']],
  ['divan', ['mato', 'Sofa']],
]);

describe('search terms', () => {
  it('drops stopwords and 1-char tokens', () => {
    expect(queryTokens(normalizeSearch('краска для дивана'))).toEqual(['kraska', 'divana']);
    expect(queryTokens('mebel uchun a boyoq')).toEqual(['mebel', 'boyoq']);
  });

  it('weights phrase > tokens > synonyms and dedupes', () => {
    const terms = buildSearchTerms(normalizeSearch('Краска для дивана'), synonyms);
    expect(terms).toEqual([
      { term: 'kraska dlya divana', weight: 1.5 },
      { term: 'kraska', weight: 1 },
      { term: 'divana', weight: 1 },
      { term: 'boyoq', weight: 0.6 },
      { term: 'paint', weight: 0.6 },
    ]);
  });

  it('handles apostrophes and normalizes synonyms', () => {
    expect(buildSearchTerms(normalizeSearch("bo'yoq"), synonyms)).toEqual([
      { term: 'boyoq', weight: 1 },
    ]);
    expect(buildSearchTerms('divan', synonyms).map((t) => t.term)).toEqual([
      'divan',
      'mato',
      'sofa',
    ]);
  });

  it('keeps a token weight when it is also a synonym', () => {
    const terms = buildSearchTerms('kraska boyoq', synonyms);
    expect(terms.find((t) => t.term === 'boyoq')?.weight).toBe(1);
  });

  it('returns nothing for empty or stopword-only queries', () => {
    expect(buildSearchTerms('', synonyms)).toEqual([]);
    expect(buildSearchTerms('dlya', synonyms)).toEqual([]);
  });
});
