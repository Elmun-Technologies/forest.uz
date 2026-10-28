import { type AdPlatform, allocateByShares } from '@forest/contracts';

/**
 * Puts imported ad spend on A2 source rows (CLAUDE.md §6): a campaign's spend matches rows of the
 * same platform whose utm campaign equals its name or id (case-insensitive). One Meta campaign
 * often runs on instagram and facebook rows: its spend is split by their sessions, so nothing is
 * counted twice. Spend that matches no row is returned for spend-only rows.
 */
export interface SpendRowRef {
  key: string;
  platform: AdPlatform | null;
  campaign: string | null;
  sessions: number;
}

export interface CampaignSpend {
  platform: string;
  campaignId: string;
  campaign: string;
  spendTiyin: bigint;
}

export function distributeSpend(
  rows: readonly SpendRowRef[],
  spends: readonly CampaignSpend[],
): { byRow: Map<string, bigint>; unmatched: CampaignSpend[] } {
  const byRow = new Map<string, bigint>();
  const unmatched: CampaignSpend[] = [];
  for (const s of spends) {
    const names = new Set([s.campaign.toLowerCase(), s.campaignId.toLowerCase()]);
    const matches = rows.filter(
      (r) => r.platform === s.platform && r.campaign && names.has(r.campaign.toLowerCase()),
    );
    if (!matches.length) {
      unmatched.push(s);
      continue;
    }
    const weights = matches.some((m) => m.sessions > 0)
      ? matches.map((m) => m.sessions)
      : matches.map(() => 1);
    allocateByShares(s.spendTiyin, weights).forEach((part, i) => {
      const k = matches[i]!.key;
      byRow.set(k, (byRow.get(k) ?? 0n) + part);
    });
  }
  return { byRow, unmatched };
}
