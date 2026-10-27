import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { messageTemplates } from '../../../../packages/db/src/seed/data/content';

const MIGRATION = path.resolve(
  __dirname,
  '../../../../packages/db/prisma/migrations/20261027120000_message_templates_backfill/migration.sql',
);

interface Row {
  key: string;
  body: unknown;
  buttons: unknown;
  delayMin: number;
  smsFallback: boolean;
}

/** Rows of the backfill INSERT: ('id', 'key', '<json>'::jsonb, '<json>'::jsonb|NULL, n, bool, …). */
function migrationRows(): Row[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const lit = "'((?:[^']|'')*)'";
  const row = new RegExp(
    `\\(${lit}, ${lit}, ${lit}::jsonb, (?:${lit}::jsonb|NULL), (\\d+), (true|false), true, CURRENT_TIMESTAMP\\)`,
    'g',
  );
  const un = (s: string) => s.replace(/''/g, "'");
  return [...sql.matchAll(row)].map((m) => ({
    key: un(m[2]!),
    body: JSON.parse(un(m[3]!)),
    buttons: m[4] === undefined ? null : JSON.parse(un(m[4])),
    delayMin: Number(m[5]),
    smsFallback: m[6] === 'true',
  }));
}

/** Template keys the API code sends (string literals next to the send APIs). */
function keysSentByCode(): Set<string> {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(
          /(?:orderStatus\([^,()]+,\s*|templateKey:\s*|template:\s*)'([a-z0-9_]+)'/g,
        ))
          keys.add(m[1]!);
      }
    }
  };
  walk(path.resolve(__dirname, '..'));
  return keys;
}

describe('message template backfill migration', () => {
  const rows = migrationRows();

  it('parses every row and has each key once', () => {
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('inserts exactly the seed texts', () => {
    for (const r of rows) {
      const seed = messageTemplates.find((t) => t.key === r.key);
      expect(seed, r.key).toBeDefined();
      expect(r).toEqual({
        key: seed!.key,
        body: seed!.body,
        buttons: seed!.buttons ?? null,
        delayMin: seed!.delayMin ?? 0,
        smsFallback: seed!.smsFallback ?? false,
      });
    }
  });

  it('covers every template key the API sends', () => {
    const sent = keysSentByCode();
    expect(sent.size).toBeGreaterThanOrEqual(12);
    expect([...sent].filter((k) => !rows.some((r) => r.key === k))).toEqual([]);
  });
});
