import { HttpClient } from '../http-client';
import { ManualFiscalProvider } from './manual-fiscal';
import { normalizeBotUsername, telegramGetMe } from './telegram';

const TOKEN = '123456789:AAH-test-token_ForestUz0123456789abcd';

function client(status: number, body: unknown, seen: string[] = []) {
  const fetchImpl = (async (url: string) => {
    seen.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return new HttpClient('telegram', { fetchImpl, sleep: async () => undefined, maxRetries: 0 });
}

describe('telegram bot health check', () => {
  it('normalizes usernames', () => {
    expect(normalizeBotUsername('@forest_uz_bot')).toBe('forest_uz_bot');
    expect(normalizeBotUsername(' Forest_UZ_bot ')).toBe('Forest_UZ_bot');
    expect(normalizeBotUsername('bad name')).toBe('');
  });

  it('calls getMe and requires the configured username', async () => {
    const seen: string[] = [];
    const ok = await telegramGetMe(
      client(200, { ok: true, result: { id: 1, is_bot: true, username: 'forest_uz_bot' } }, seen),
      TOKEN,
      '@Forest_uz_bot',
    );
    expect(ok).toEqual({ ok: true, message: 'bot @forest_uz_bot' });
    expect(seen[0]).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);

    const other = await telegramGetMe(
      client(200, { ok: true, result: { is_bot: true, username: 'other_bot' } }),
      TOKEN,
      'forest_uz_bot',
    );
    expect(other.ok).toBe(false);
    const bad = await telegramGetMe(
      client(401, { ok: false, description: 'Unauthorized' }),
      TOKEN,
      'forest_uz_bot',
    );
    expect(bad).toEqual({ ok: false, message: 'getMe failed: HTTP 401 Unauthorized' });
    expect((await telegramGetMe(client(200, {}), 'nope', 'forest_uz_bot')).ok).toBe(false);
  });
});

describe('manual fiscal provider', () => {
  it('issues nothing (operator records the receipt)', async () => {
    const r = await new ManualFiscalProvider().issueReceipt({
      orderNumber: 'F-10001',
      paymentId: 'p',
      items: [],
      totalTiyin: 0n,
      isRefund: false,
    });
    expect(r).toBeNull();
  });
});
