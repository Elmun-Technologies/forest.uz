import { DomainError } from '@forest/contracts';
import type { Prisma, Redirect } from '@forest/db';
import { normalizePath, redirectCandidates } from './seo-paths';

type Tx = Prisma.TransactionClient;

/** Longest chain we follow before calling it a loop (real chains are collapsed on write). */
const MAX_HOPS = 20;

/**
 * Final destination of a new `from → to` through the existing redirects (`lookup(from) → to`), so
 * no chain is ever stored. Reaching `from` again (or too many hops) is a loop.
 */
export async function resolveTarget(
  from: string,
  to: string,
  lookup: (path: string) => Promise<string | null>,
): Promise<string> {
  let current = to;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (current === from) throw new DomainError('REDIRECT_LOOP', undefined, 'to');
    const next = await lookup(current);
    if (next === null) return current;
    current = next;
  }
  throw new DomainError('REDIRECT_LOOP', undefined, 'to');
}

/**
 * Same-site path from a path or an absolute URL on `siteHost`, in the canonical form redirects are
 * stored in: no trailing slash (except "/"). Lookups match both slash variants
 * (`redirectCandidates`), so storing one form is what keeps loop/chain checks exact. null when it
 * isn't a same-site path.
 */
export function sitePath(input: string, siteHost: string | null): string | null {
  const raw = input.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      if (siteHost && new URL(raw).host !== siteHost) return null;
    } catch {
      return null;
    }
  }
  const path = normalizePath(raw);
  return path === null ? null : path.replace(/\/+$/, '') || '/';
}

export interface SaveRedirectOptions {
  /** Host of APP_URL: absolute targets must point at our own site. */
  siteHost: string | null;
  /** Row being edited (excluded from chain lookups and re-pointing). */
  id?: string;
  /** Live storefront paths: a redirect from a working page would never fire (`REDIRECT_SOURCE_LIVE`). */
  live?: ReadonlySet<string>;
}

/**
 * The one way redirects are written (A9 manager and product slug moves, CLAUDE.md §6): normalised
 * paths, target collapsed to its final destination, redirects pointing at `from` re-pointed (no
 * chains), loops refused, and the source's 404-log row removed. Runs inside the caller's
 * transaction.
 */
export async function saveRedirect(
  tx: Tx,
  input: { from: string; to: string; code: number },
  opts: SaveRedirectOptions,
): Promise<Redirect> {
  const from = sitePath(input.from, opts.siteHost);
  const to = sitePath(input.to, opts.siteHost);
  if (!from || from === '/') throw new DomainError('REDIRECT_INVALID_PATH', undefined, 'from');
  if (!to) throw new DomainError('REDIRECT_INVALID_PATH', undefined, 'to');
  if (opts.live && redirectCandidates(from).some((p) => opts.live!.has(p)))
    throw new DomainError('REDIRECT_SOURCE_LIVE', undefined, 'from');

  const others = opts.id ? { id: { not: opts.id } } : {};
  // Both slash variants, exactly like the storefront lookup (`SeoService.redirect`).
  const final = await resolveTarget(from, to, async (path) => {
    const row = await tx.redirect.findFirst({
      where: { from: { in: redirectCandidates(path) }, ...others },
    });
    return row ? (sitePath(row.to, null) ?? row.to) : null;
  });

  await tx.redirect.updateMany({
    where: { to: { in: redirectCandidates(from) }, ...others },
    data: { to: final },
  });
  const row = opts.id
    ? await tx.redirect.update({
        where: { id: opts.id },
        data: { from, to: final, code: input.code },
      })
    : await tx.redirect.upsert({
        where: { from },
        create: { from, to: final, code: input.code },
        update: { to: final, code: input.code },
      });
  await tx.notFoundLog.deleteMany({ where: { path: { in: redirectCandidates(from) } } });
  return row;
}
