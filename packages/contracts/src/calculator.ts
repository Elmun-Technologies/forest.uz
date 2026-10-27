import type { Tiyin } from './money';

export interface CalcVariant {
  variantId: string;
  volumeMl: number;
  priceTiyin: Tiyin;
  available: boolean;
}

export interface CalcRecommendation {
  litersNeeded: number;
  items: { variantId: string; qty: number }[];
  totalTiyin: Tiyin;
  coveredMl: number;
}

/** Liters needed rounded up to 0.1 L (as shown on the product page: "0,6 litr kerak"). */
export function litersNeeded(areaM2: number, coats: number, coverageM2PerL: number): number {
  if (areaM2 <= 0 || coats <= 0 || coverageM2PerL <= 0) return 0;
  return Math.ceil(((areaM2 * coats) / coverageM2PerL) * 10 - 1e-9) / 10;
}

/**
 * Cheapest combination of available variants whose total volume covers the need.
 * Unbounded knapsack over 50 ml steps; catalogs have ≤ 5 volumes so this is tiny.
 */
export function recommendVariants(
  areaM2: number,
  coats: number,
  coverageM2PerL: number,
  variants: readonly CalcVariant[],
): CalcRecommendation | null {
  const liters = litersNeeded(areaM2, coats, coverageM2PerL);
  const usable = variants.filter((v) => v.available && v.volumeMl > 0);
  if (liters === 0 || usable.length === 0) return null;
  const STEP = 50;
  const need = Math.ceil((liters * 1000) / STEP);
  const maxVol = Math.max(...usable.map((v) => Math.ceil(v.volumeMl / STEP)));
  const limit = need + maxVol;
  const best: (Tiyin | null)[] = new Array(limit + 1).fill(null);
  const choice: number[] = new Array(limit + 1).fill(-1);
  best[0] = 0n;
  for (let vol = 1; vol <= limit; vol++) {
    usable.forEach((v, idx) => {
      const units = Math.ceil(v.volumeMl / STEP);
      const prev = vol - units;
      const prevCost = prev >= 0 ? best[prev] : null;
      if (prevCost === null || prevCost === undefined) return;
      const cost = prevCost + v.priceTiyin;
      const current = best[vol];
      if (current === null || current === undefined || cost < current) {
        best[vol] = cost;
        choice[vol] = idx;
      }
    });
  }
  let bestVol = -1;
  for (let vol = need; vol <= limit; vol++) {
    const c = best[vol];
    if (c === null || c === undefined) continue;
    const bc = bestVol >= 0 ? best[bestVol] : null;
    if (bc === null || bc === undefined || c < bc) bestVol = vol;
  }
  if (bestVol < 0) return null;
  const counts = new Map<string, number>();
  let coveredMl = 0;
  for (let vol = bestVol; vol > 0;) {
    const v = usable[choice[vol] ?? -1];
    if (!v) break;
    counts.set(v.variantId, (counts.get(v.variantId) ?? 0) + 1);
    coveredMl += v.volumeMl;
    vol -= Math.ceil(v.volumeMl / STEP);
  }
  return {
    litersNeeded: liters,
    items: [...counts.entries()].map(([variantId, qty]) => ({ variantId, qty })),
    totalTiyin: best[bestVol] ?? 0n,
    coveredMl,
  };
}
