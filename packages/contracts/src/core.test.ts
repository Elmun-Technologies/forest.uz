import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Follows value (non-type) relative imports from `file` and returns every module specifier seen. */
function valueImports(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^(?:import|export)(?!\s+type\b)[^'"]*from\s+'([^']+)'/gm)) {
    const spec = m[1]!;
    if (spec.startsWith('.')) valueImports(resolve(dirname(file), `${spec}.ts`), seen);
    else seen.add(spec);
  }
  return seen;
}

describe('core entry', () => {
  it('does not pull zod into browser bundles', () => {
    expect([...valueImports(resolve(here, 'core.ts'))]).not.toContain('zod');
  });
});
