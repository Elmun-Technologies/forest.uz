import { describe, expect, it } from 'vitest';
import { closestPath, editDistance } from './closest-path';

const live = [
  '/uz',
  '/uz/katalog',
  '/uz/p/chalk-white',
  '/uz/p/chalk-black',
  '/ru/p/chalk-white',
  '/uz/oferta',
];

describe('closestPath (404 → create redirect suggestion)', () => {
  it('computes edit distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });

  it('suggests the closest live path in the same locale', () => {
    expect(closestPath('/uz/p/chalk-whte', live)).toBe('/uz/p/chalk-white');
    expect(closestPath('/ru/p/chalk-whit', live)).toBe('/ru/p/chalk-white');
    expect(closestPath('/uz/katalogg/', live)).toBe('/uz/katalog');
  });

  it('returns null when nothing is close enough or only other locales match', () => {
    expect(closestPath('/uz/p/completely-different-product-name', live)).toBeNull();
    expect(closestPath('/en/p/chalk-white', live)).toBeNull();
  });
});
