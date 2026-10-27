import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Telegram Login Widget check (core.telegram.org/widgets/login-legacy; implemented from
 * aiogram `utils/auth_widget.py` and python-social-auth `backends/telegram.py`, see
 * docs/runbooks/messaging-and-fiscal.md):
 *   data_check_string = every received field except `hash`, as `key=value`, sorted, joined by \n
 *   secret_key        = SHA256(bot_token)
 *   hash              = hex(HMAC_SHA256(secret_key, data_check_string))
 */
export const TELEGRAM_LOGIN_POLICY = {
  /** Telegram recommends checking `auth_date`; 24 h like python-social-auth. */
  maxAgeSec: 24 * 3600,
  /** Clock skew tolerated for an `auth_date` in the future. */
  futureSkewSec: 5 * 60,
  perIpPerMinute: 10,
} as const;

export interface TelegramUser {
  id: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}

export type TelegramLoginResult =
  { ok: true; user: TelegramUser } | { ok: false; reason: 'malformed' | 'hash' | 'expired' };

/**
 * Null when a value contains a line feed: distinct payloads would otherwise produce the same
 * signed string (python-social-auth rejects these for that reason).
 */
export function telegramDataCheckString(data: Record<string, string | number>): string | null {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === 'hash') continue;
    const line = `${key}=${String(value)}`;
    if (line.includes('\n')) return null;
    lines.push(line);
  }
  // Byte order of ASCII keys = Python's sorted(); keys are validated as [a-z_] upstream.
  return lines.sort().join('\n');
}

export function telegramLoginHash(dataCheckString: string, botToken: string): string {
  const secret = createHash('sha256').update(botToken, 'utf8').digest();
  return createHmac('sha256', secret).update(dataCheckString, 'utf8').digest('hex');
}

export function verifyTelegramLogin(
  data: Record<string, string | number>,
  botToken: string,
  nowSec: number,
): TelegramLoginResult {
  const received = data.hash;
  const dcs = telegramDataCheckString(data);
  if (typeof received !== 'string' || !/^[0-9a-f]{64}$/.test(received) || dcs === null)
    return { ok: false, reason: 'malformed' };
  const expected = Buffer.from(telegramLoginHash(dcs, botToken), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(received, 'hex')))
    return { ok: false, reason: 'hash' };

  const authDate = Number(data.auth_date);
  const id = String(data.id ?? '');
  if (!Number.isSafeInteger(authDate) || !/^\d{1,20}$/.test(id))
    return { ok: false, reason: 'malformed' };
  if (
    nowSec - authDate > TELEGRAM_LOGIN_POLICY.maxAgeSec ||
    authDate - nowSec > TELEGRAM_LOGIN_POLICY.futureSkewSec
  )
    return { ok: false, reason: 'expired' };

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);
  return {
    ok: true,
    user: {
      id: BigInt(id),
      username: str(data.username),
      firstName: str(data.first_name),
      lastName: str(data.last_name),
    },
  };
}
