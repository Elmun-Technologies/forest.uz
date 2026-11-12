import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { colors } from './tokens';

/** WCAG 2.x relative luminance / contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('colour tokens', () => {
  const theme = readFileSync(resolve(process.cwd(), 'src/theme.css'), 'utf8');

  it('tokens.ts mirrors theme.css', () => {
    for (const [name, value] of Object.entries({
      muted: colors.muted,
      subtle: colors.subtle,
      canvas: colors.canvas,
      panel: colors.panel,
    })) {
      expect(theme).toContain(`--color-${name}: ${value.toLowerCase()};`);
    }
  });

  it('text tokens meet WCAG AA (4.5:1) on white and on the canvas', () => {
    for (const fg of [colors.ink, colors.ink2, colors.muted, colors.subtle]) {
      expect(contrast(fg, colors.panel)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg, colors.canvas)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('subtle stays lighter than muted (tertiary vs secondary text)', () => {
    expect(luminance(colors.subtle)).toBeGreaterThan(luminance(colors.muted));
  });
});
