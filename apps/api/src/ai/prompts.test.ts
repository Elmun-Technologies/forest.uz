import { describe, expect, it } from 'vitest';
import { clip, factsBlock, scrubPii } from './prompts';

describe('ai prompts', () => {
  it('masks phones, emails, cards, ids and links', () => {
    const out = scrubPii(
      'Salom, raqamim +998 90 123-45-67, yoki 901234567. Email aziza@mail.uz. ' +
        'Karta 8600 1234 5678 9012. Buyurtma F-10482, mijoz C-10001. https://forest.uz/t/abc',
    );
    expect(out).not.toMatch(
      /123-45-67|901234567|aziza@mail|8600 1234|F-10482|C-10001|forest\.uz\/t/,
    );
    expect(out).toContain('[phone]');
    expect(out).toContain('[email]');
    expect(out).toContain('[id]');
    expect(out).toContain('[link]');
  });

  it('keeps ordinary text', () => {
    expect(scrubPii('Divan uchun 2 ta ballon kerakmi?')).toBe('Divan uchun 2 ta ballon kerakmi?');
  });

  it('lists only present facts', () => {
    expect(factsBlock({ name: 'Chalk White', empty: '', none: null, list: [], specs: ['a'] })).toBe(
      '- name: Chalk White\n- specs: ["a"]',
    );
  });

  it('clips on a word boundary', () => {
    expect(clip('one two three', 9)).toBe('one two…');
    expect(clip(42, 5)).toBe('');
  });
});
