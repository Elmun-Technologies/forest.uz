import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INPUT_MASK, maskInput, maskText, RECORD_OPTIONS } from './options';

describe('replay recorder privacy options', () => {
  it('masks every input with a constant (no value, no length)', () => {
    expect(RECORD_OPTIONS.maskAllInputs).toBe(true);
    expect(maskInput('+998 90 123 45 67')).toBe(INPUT_MASK);
    expect(maskInput('Ali')).toBe(INPUT_MASK);
    expect(maskInput('')).toBe('');
  });

  it('masks [data-private] text and blocks [data-private="block"]', () => {
    expect(RECORD_OPTIONS.maskTextSelector).toBe('[data-private]');
    expect(RECORD_OPTIONS.blockSelector).toBe('[data-private="block"]');
    expect(maskText('Toshkent, Chilonzor 5')).toBe('••••••••• ••••••••• •');
  });

  it('records no canvas, fonts, inlined images or cross-origin frames', () => {
    expect(RECORD_OPTIONS).toMatchObject({
      recordCanvas: false,
      collectFonts: false,
      inlineImages: false,
      recordCrossOriginIframes: false,
    });
  });

  it('the bundle carries no rrweb console/network plugin', () => {
    const src = readFileSync(new URL('./recorder.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/getRecordConsolePlugin|getRecordNetworkPlugin|plugins\s*:/);
  });
});
