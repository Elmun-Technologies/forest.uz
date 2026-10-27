// Wraps dist/t.js as an importable module: the storefront route `/t.js` serves TRACKER_SOURCE
// and versions the URL with TRACKER_VERSION (content hash → long-lived browser cache).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const source = readFileSync(new URL('../dist/t.js', import.meta.url), 'utf8');
const version = createHash('sha256').update(source).digest('hex').slice(0, 12);
const gz = gzipSync(source, { level: 9 }).length;

writeFileSync(
  new URL('../dist/index.js', import.meta.url),
  `export const TRACKER_SOURCE = ${JSON.stringify(source)};\nexport const TRACKER_VERSION = ${JSON.stringify(version)};\nexport const TRACKER_GZIP_BYTES = ${gz};\n`,
);
writeFileSync(
  new URL('../dist/index.d.ts', import.meta.url),
  '/** Minified tracker script (IIFE). */\nexport declare const TRACKER_SOURCE: string;\n/** Content hash of TRACKER_SOURCE (12 hex chars). */\nexport declare const TRACKER_VERSION: string;\nexport declare const TRACKER_GZIP_BYTES: number;\n',
);
console.warn(`tracker: ${source.length} B, ${gz} B gzip, version ${version}`);
