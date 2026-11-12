import { isValidIkpu, isValidPackageCode } from '@forest/contracts';

/**
 * One order line as it must appear on a fiscal receipt — the common input of the Payme receipt
 * `detail` and the Click `ofd_data/submit_items` call (both need IKPU + package code + VAT).
 */
export interface ReceiptLineInput {
  title: string;
  ikpu: string;
  packageCode: string | null;
  vatPercent: number;
  qty: number;
  unitPriceTiyin: bigint;
  /** Discount for the whole line (all units), tiyin. */
  discountTiyin: bigint;
}

/**
 * Why these lines can't be fiscalized by a payment provider, or null when they can. Every line
 * needs a real IKPU and package code (the state classifier rejects a receipt otherwise); the
 * order is then closed with a manually recorded receipt instead (CLAUDE.md §6 fiscal rule).
 */
export function fiscalLinesProblem(lines: ReceiptLineInput[]): string | null {
  if (!lines.length) return 'no lines';
  const noIkpu = lines.filter((l) => !isValidIkpu(l.ikpu)).length;
  if (noIkpu) return `${noIkpu} line(s) without a valid IKPU`;
  const noPackage = lines.filter((l) => !isValidPackageCode(l.packageCode)).length;
  if (noPackage) return `${noPackage} line(s) without a package code`;
  return null;
}

/** VAT included in a gross amount (prices are VAT-inclusive), rounded to the tiyin. */
export function vatIncluded(grossTiyin: bigint, vatPercent: number): bigint {
  if (vatPercent <= 0) return 0n;
  const pct = BigInt(vatPercent);
  return (grossTiyin * pct * 2n + (100n + pct)) / ((100n + pct) * 2n);
}
