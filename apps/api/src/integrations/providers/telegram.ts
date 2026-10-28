import type { HttpClient } from '../http-client';
import type { HealthResult } from './types';

/** Bot API root (aiogram `client/telegram.py`: https://api.telegram.org/bot{token}/{method}). */
export const TELEGRAM_API_URL = 'https://api.telegram.org';

/** `@Forest_UZ_bot` / `forest_uz_bot` → `forest_uz_bot`-style username as entered, without `@`. */
export function normalizeBotUsername(value: string): string {
  const v = value.trim().replace(/^@/, '');
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(v) ? v : '';
}

/**
 * Health check: `getMe` must answer `{ ok: true, result: { is_bot: true, username } }` and the
 * username must be the one configured for the login widget (the widget only works for the bot
 * whose token signs the data).
 */
export async function telegramGetMe(
  http: HttpClient,
  botToken: string,
  expectedUsername: string | undefined,
  apiUrl = TELEGRAM_API_URL,
): Promise<HealthResult> {
  if (!/^\d+:[\w-]{20,}$/.test(botToken)) return { ok: false, message: 'bot token format' };
  try {
    const res = await http.request({ method: 'GET', url: `${apiUrl}/bot${botToken}/getMe` });
    const body = JSON.parse(res.text) as {
      ok?: boolean;
      result?: { is_bot?: boolean; username?: string };
      description?: string;
    };
    if (res.status !== 200 || !body.ok || !body.result?.is_bot)
      return {
        ok: false,
        message: `getMe failed: HTTP ${res.status} ${body.description ?? ''}`.trim(),
      };
    const actual = body.result.username ?? '';
    const expected = normalizeBotUsername(expectedUsername ?? '');
    if (!expected || actual.toLowerCase() !== expected.toLowerCase())
      return { ok: false, message: `bot username is @${actual}, configured "${expected}"` };
    return { ok: true, message: `bot @${actual}` };
  } catch (e) {
    return { ok: false, message: `getMe failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Updates the bot handles (docs/09); `my_chat_member` reports a user blocking the bot. */
export const TELEGRAM_ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'] as const;

/** `/v1/webhooks/telegram/<secret>` — the secret is also sent back as `secret_token`. */
export function telegramWebhookUrl(apiUrl: string, secret: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/v1/webhooks/telegram/${secret}`;
}

/**
 * `setWebhook` (Bot API; grammY `@grammyjs/types` 5.0.0, python-telegram-bot 22.0
 * `Bot.set_webhook`): Telegram then POSTs every update to `url` with header
 * `X-Telegram-Bot-Api-Secret-Token: <secret>`.
 */
export async function telegramSetWebhook(
  http: HttpClient,
  botToken: string,
  url: string,
  secret: string,
  apiUrl = TELEGRAM_API_URL,
): Promise<HealthResult> {
  try {
    const res = await http.request({
      method: 'POST',
      url: `${apiUrl}/bot${botToken}/setWebhook`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        secret_token: secret,
        allowed_updates: TELEGRAM_ALLOWED_UPDATES,
        max_connections: 20,
      }),
      // setWebhook is idempotent (same url + secret).
      idempotent: true,
    });
    const body = JSON.parse(res.text) as { ok?: boolean; description?: string };
    return res.status === 200 && body.ok
      ? { ok: true, message: 'webhook set' }
      : {
          ok: false,
          message: `setWebhook failed: HTTP ${res.status} ${body.description ?? ''}`.trim(),
        };
  } catch (e) {
    return {
      ok: false,
      message: `setWebhook failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
