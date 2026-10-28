import { describe, expect, it } from 'vitest';
import { WEBHOOK_POLICY, webhookRetryDelaySec } from './automation';
import {
  apiKeyCreateSchema,
  partnerStockQuerySchema,
  webhookCreateSchema,
} from './schemas/automation';
import { articleSaveSchema } from './schemas/cms';

describe('webhook retry schedule', () => {
  it('8 attempts: 7 waits growing, then dead', () => {
    const waits = [1, 2, 3, 4, 5, 6, 7].map(webhookRetryDelaySec);
    expect(waits).toEqual([30, 120, 600, 1800, 3600, 10_800, 21_600]);
    expect(webhookRetryDelaySec(WEBHOOK_POLICY.maxAttempts)).toBeNull();
    expect(webhookRetryDelaySec(9)).toBeNull();
  });
});

describe('automation inputs', () => {
  it('webhook: known events, deduplicated; no credentials in the URL', () => {
    const ok = webhookCreateSchema.parse({
      url: 'https://hooks.example.com/forest',
      events: ['order.paid', 'order.paid'],
    });
    expect(ok.events).toEqual(['order.paid']);
    expect(
      webhookCreateSchema.safeParse({ url: 'https://a:b@x.com', events: ['order.paid'] }).success,
    ).toBe(false);
    expect(
      webhookCreateSchema.safeParse({ url: 'https://x.com', events: ['cart.updated'] }).success,
    ).toBe(false);
    expect(webhookCreateSchema.safeParse({ url: 'https://x.com', events: [] }).success).toBe(false);
  });

  it('api key: scopes and rate limit bounds', () => {
    expect(apiKeyCreateSchema.parse({ name: 'n8n', scopes: ['stock:read'] }).rateLimitPerMin).toBe(
      60,
    );
    expect(apiKeyCreateSchema.safeParse({ name: 'x', scopes: ['orders:write'] }).success).toBe(
      false,
    );
    expect(
      apiKeyCreateSchema.safeParse({ name: 'x', scopes: ['stock:read'], rateLimitPerMin: 601 })
        .success,
    ).toBe(false);
  });

  it('partner stock query: SKUs kept as typed, case-insensitive duplicates dropped, ≤ 100', () => {
    const q = partnerStockQuerySchema.parse({ sku: 'fr-cw-1, FR-CW-1,,Fr-Fs' });
    expect(q.sku).toEqual(['fr-cw-1', 'Fr-Fs']);
    const many = Array.from({ length: 150 }, (_, i) => `S${i}`).join(',');
    expect(partnerStockQuerySchema.parse({ sku: many }).sku).toHaveLength(100);
  });

  it('article: a published locale needs a title; https video only', () => {
    const base = { slug: 'komod', uz: { title: 'Komod', published: true }, ru: { title: '' } };
    expect(articleSaveSchema.safeParse(base).success).toBe(true);
    expect(
      articleSaveSchema.safeParse({ ...base, ru: { title: '', published: true } }).success,
    ).toBe(false);
    expect(articleSaveSchema.safeParse({ ...base, videoUrl: 'http://x.com/v' }).success).toBe(
      false,
    );
    expect(articleSaveSchema.safeParse({ ...base, slug: 'Bad Slug' }).success).toBe(false);
  });
});
