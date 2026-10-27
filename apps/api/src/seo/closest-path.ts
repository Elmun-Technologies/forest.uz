/** Levenshtein distance (two-row DP); inputs are short URL paths. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * "Create redirect" suggestion for a 404 (docs/10): the live path closest to `missing` within the
 * same first segment (locale), when the edit distance is ≤ 40 % of the longer path. Ties → the
 * shorter candidate, then alphabetical (stable output).
 */
export function closestPath(missing: string, live: Iterable<string>): string | null {
  const clean = missing.replace(/\/+$/, '') || '/';
  const prefix = clean.split('/')[1] ?? '';
  let best: { path: string; d: number } | null = null;
  for (const path of live) {
    if (path === clean || (path.split('/')[1] ?? '') !== prefix) continue;
    const d = editDistance(clean, path);
    if (d > 0.4 * Math.max(clean.length, path.length)) continue;
    if (
      !best ||
      d < best.d ||
      (d === best.d &&
        (path.length < best.path.length || (path.length === best.path.length && path < best.path)))
    )
      best = { path, d };
  }
  return best?.path ?? null;
}
