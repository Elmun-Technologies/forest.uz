import { readFileSync } from 'node:fs';
import path from 'node:path';

let cached: string | null | undefined;

/**
 * `X-Dev-Token` for the API's dev endpoints (CLAUDE.md §6): `DEV_ENDPOINTS_TOKEN` from the
 * environment (CI), else from the repo's `.env` (dev stack; `pnpm dev` generates it). Without a
 * token the header is omitted (an API without DEV_ENDPOINTS_TOKEN outside production is open).
 */
export function devHeaders(): Record<string, string> {
  if (cached === undefined) {
    cached = process.env.DEV_ENDPOINTS_TOKEN ?? null;
    if (!cached) {
      try {
        const env = readFileSync(path.resolve(__dirname, '../.env'), 'utf8');
        cached = env.match(/^DEV_ENDPOINTS_TOKEN=([^#\n]*)/m)?.[1]?.trim() || null;
      } catch {
        cached = null;
      }
    }
  }
  return cached ? { 'X-Dev-Token': cached } : {};
}
