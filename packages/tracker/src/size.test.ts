import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/** docs/07 + Phase 4 acceptance: the core script stays under 6 KB gzipped. */
const BUDGET = 6 * 1024;
const built = new URL('../dist/t.js', import.meta.url);

describe('bundle size', () => {
  it('dist/t.js < 6 KB gzip', () => {
    expect(existsSync(built), 'run `pnpm --filter @forest/tracker build` first').toBe(true);
    const gz = gzipSync(readFileSync(built), { level: 9 }).length;
    expect(gz).toBeLessThan(BUDGET);
  });

  it('is self-contained (no imports, no zod)', () => {
    const src = readFileSync(built, 'utf8');
    expect(src).not.toMatch(/\brequire\(|\bimport[\s(]/);
    expect(src).not.toContain('ZodError');
  });
});
