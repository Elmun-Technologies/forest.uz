import { distributeSpend } from './ad-spend-match';

describe('distributeSpend', () => {
  const rows = [
    { key: 'ig', platform: 'meta' as const, campaign: 'Divan_Reels', sessions: 300 },
    { key: 'fb', platform: 'meta' as const, campaign: 'divan_reels', sessions: 100 },
    { key: 'g', platform: 'google' as const, campaign: '777', sessions: 50 },
    { key: 'tg', platform: null, campaign: 'divan_reels', sessions: 999 },
  ];

  it('splits one campaign across its rows by sessions (no double count)', () => {
    const r = distributeSpend(rows, [
      { platform: 'meta', campaignId: '1', campaign: 'divan_reels', spendTiyin: 400_000n },
    ]);
    expect(r.byRow.get('ig')).toBe(300_000n);
    expect(r.byRow.get('fb')).toBe(100_000n);
    expect(r.byRow.has('tg')).toBe(false);
    expect(r.unmatched).toEqual([]);
  });

  it('matches by campaign id; unmatched spend is returned', () => {
    const spends = [
      { platform: 'google', campaignId: '777', campaign: 'Brand', spendTiyin: 5_000n },
      { platform: 'tiktok', campaignId: 't1', campaign: 'test', spendTiyin: 9n },
    ];
    const r = distributeSpend(rows, spends);
    expect(r.byRow.get('g')).toBe(5_000n);
    expect(r.unmatched).toEqual([spends[1]]);
  });

  it('rows without sessions share equally', () => {
    const r = distributeSpend(
      [
        { key: 'a', platform: 'meta', campaign: 'x', sessions: 0 },
        { key: 'b', platform: 'meta', campaign: 'x', sessions: 0 },
      ],
      [{ platform: 'meta', campaignId: 'x', campaign: 'x', spendTiyin: 3n }],
    );
    expect((r.byRow.get('a') ?? 0n) + (r.byRow.get('b') ?? 0n)).toBe(3n);
  });
});
