import type { AdPlatform, AdSpendRow } from '@forest/contracts';

/**
 * Ad spend API import (docs/07 "ad spend (imported)"): one adapter per platform (Meta Marketing
 * API insights, Google Ads reporting, TikTok, Yandex Direct) returning daily campaign rows in
 * so'm-tiyin. No real adapter exists yet — sandbox/live answer INTEGRATION_NOT_CONFIGURED (see
 * `AdSpendService.sync`); the fake serves tests and demos in PROVIDERS_MODE=fake.
 */
export interface AdSpendSource {
  readonly platform: AdPlatform;
  /** Daily rows for [from, to] (Tashkent `YYYY-MM-DD`, inclusive). */
  fetchDaily(from: string, to: string): Promise<AdSpendRow[]>;
}

/** In-memory fake: returns the rows a test or demo seeded for its platform and range. */
export class FakeAdSpendSource implements AdSpendSource {
  private static readonly rows: AdSpendRow[] = [];

  constructor(readonly platform: AdPlatform) {}

  static seed(rows: readonly AdSpendRow[]): void {
    FakeAdSpendSource.rows.push(...rows);
  }

  static reset(): void {
    FakeAdSpendSource.rows.length = 0;
  }

  async fetchDaily(from: string, to: string): Promise<AdSpendRow[]> {
    return FakeAdSpendSource.rows.filter(
      (r) => r.platform === this.platform && r.date >= from && r.date <= to,
    );
  }
}
