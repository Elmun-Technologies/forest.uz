import type { Env } from './env';

/** SESSION_SECRET first (signs everything new), then earlier values accepted for verification. */
export function sessionSecrets(
  env: Pick<Env, 'SESSION_SECRET' | 'SESSION_SECRET_PREVIOUS'>,
): string[] {
  return [
    env.SESSION_SECRET,
    ...env.SESSION_SECRET_PREVIOUS.filter((s) => s !== env.SESSION_SECRET),
  ];
}

/** First successful verification under the current or an earlier secret. */
export function verifyWithAny<T>(
  env: Pick<Env, 'SESSION_SECRET' | 'SESSION_SECRET_PREVIOUS'>,
  verify: (secret: string) => T | null,
): T | null {
  for (const secret of sessionSecrets(env)) {
    const result = verify(secret);
    if (result !== null && result !== undefined) return result;
  }
  return null;
}
