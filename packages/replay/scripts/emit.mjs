// Wraps dist/r.js as an importable module: the storefront route `/r.js` serves RECORDER_SOURCE
// and versions the URL with RECORDER_VERSION (content hash → long-lived browser cache).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const source = readFileSync(new URL('../dist/r.js', import.meta.url), 'utf8');
const version = createHash('sha256').update(source).digest('hex').slice(0, 12);
const gz = gzipSync(source, { level: 9 }).length;

writeFileSync(
  new URL('../dist/index.js', import.meta.url),
  `export const RECORDER_SOURCE = ${JSON.stringify(source)};\nexport const RECORDER_VERSION = ${JSON.stringify(version)};\nexport const RECORDER_GZIP_BYTES = ${gz};\n`,
);
writeFileSync(
  new URL('../dist/index.d.ts', import.meta.url),
  '/** Minified session replay recorder (IIFE, rrweb). */\nexport declare const RECORDER_SOURCE: string;\n/** Content hash of RECORDER_SOURCE (12 hex chars). */\nexport declare const RECORDER_VERSION: string;\nexport declare const RECORDER_GZIP_BYTES: number;\n',
);
// eslint-disable-next-line no-console -- build summary
console.log(`replay recorder: ${source.length} B, ${gz} B gzip, version ${version}`);
