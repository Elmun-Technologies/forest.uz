// CLI for the synthetic traffic generator (needs Node ≥ 22.18 for .ts type stripping):
//   node synthetic/run.mjs --sessions 30 --seed 7 [--orders] [--base http://localhost:3000] [--out manifest.json]
import { writeFileSync } from 'node:fs';
import { generateTraffic, waitForSessions } from './traffic.ts';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const manifest = await generateTraffic({
  sessions: Number(arg('sessions') ?? 20),
  seed: Number(arg('seed') ?? 1),
  orders: process.argv.includes('--orders'),
  ...(arg('base') ? { baseURL: arg('base') } : {}),
  log: (l) => console.log(l),
});
const stored = await waitForSessions(manifest, arg('api'));
console.log(`stored sessions: ${stored.size}/${manifest.sessions.length}`);
const json = JSON.stringify(manifest, null, 2);
const out = arg('out');
if (out) {
  writeFileSync(out, json);
  console.log(`manifest → ${out}`);
} else console.log(json);
