#!/usr/bin/env node
/**
 * `pnpm dev`: one command for the full local stack.
 * 1. ensures .env exists and has generated local secrets (never touches .env.example)
 * 2. starts infra containers (postgres, redis, S3 emulator, mailpit) and waits until healthy
 * 3. applies migrations and the idempotent seed
 * 4. runs api (:4000), web (:3000), admin (:3001) in watch mode via turbo
 */
import { spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`\n✖ ${cmd} ${args.join(' ')} failed`);
    process.exit(r.status ?? 1);
  }
}

function ensureEnv() {
  if (!existsSync(envPath)) {
    copyFileSync(path.join(root, '.env.example'), envPath);
    console.log('• created .env from .env.example');
  }
  let env = readFileSync(envPath, 'utf8');
  const set = (key, value) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    env = re.test(env) ? env.replace(re, `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
  };
  const get = (key) => env.match(new RegExp(`^${key}=([^#\\n]*)`, 'm'))?.[1]?.trim() ?? '';
  let changed = false;
  if (Buffer.from(get('APP_ENCRYPTION_KEY'), 'base64').length !== 32) {
    set('APP_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    changed = true;
  }
  if (get('SESSION_SECRET').length < 32 || get('SESSION_SECRET').startsWith('generate')) {
    set('SESSION_SECRET', randomBytes(32).toString('hex'));
    changed = true;
  }
  if (get('TELEGRAM_WEBHOOK_SECRET').startsWith('generate')) {
    set('TELEGRAM_WEBHOOK_SECRET', randomBytes(16).toString('hex'));
    changed = true;
  }
  if (changed) {
    writeFileSync(envPath, env);
    console.log('• generated local dev secrets in .env (keep them private; never commit .env)');
  }
}

ensureEnv();
console.log('• starting infra (docker compose)…');
run('docker', [
  'compose',
  '-f',
  'infra/compose.yml',
  'up',
  '-d',
  '--wait',
  'postgres',
  'redis',
  'storage',
  'mailpit',
]);
console.log('• building shared packages…');
run('pnpm', [
  'exec',
  'turbo',
  'run',
  'build',
  '--filter=@forest/contracts',
  '--filter=@forest/db',
  '--output-logs=errors-only',
]);
console.log('• applying migrations + seed…');
run('pnpm', ['db:deploy']);
run('pnpm', ['db:seed']);
console.log(
  '• starting apps: web http://localhost:3000 · admin http://localhost:3001 · api http://localhost:4000',
);
const child = spawn('pnpm', ['run', 'dev:apps'], { cwd: root, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
