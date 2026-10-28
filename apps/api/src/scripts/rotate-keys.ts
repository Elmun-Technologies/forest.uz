/**
 * One-off: re-seal every stored secret with the current APP_ENCRYPTION_KEY after a key change.
 * Run once inside the api container (it has the env), with the old key in
 * APP_ENCRYPTION_KEY_PREVIOUS:  `node dist/scripts/rotate-keys.js`  (docs/runbooks/secret-rotation.md §1).
 * Prints counts only; exits 1 when some value could not be decrypted with the configured keys.
 */
import { PrismaClient } from '@forest/db';
import { loadEnv } from '../config/env';
import { rotateSealedSecrets } from '../integrations/crypto/rotate-keys';
import { keyringFromEnv, SecretBox } from '../integrations/crypto/secret-box';

async function main(): Promise<number> {
  const env = loadEnv();
  const box = new SecretBox(keyringFromEnv(env));
  const prisma = new PrismaClient();
  try {
    const report = await rotateSealedSecrets(prisma, box);
    let failed = 0;
    for (const [name, c] of Object.entries(report)) {
      failed += c.failed;
      process.stdout.write(`${name}: sealed=${c.sealed} rotated=${c.rotated} failed=${c.failed}\n`);
    }
    if (failed > 0)
      process.stderr.write(
        `${failed} value(s) were sealed with a key that is neither APP_ENCRYPTION_KEY nor in APP_ENCRYPTION_KEY_PREVIOUS — keep the previous key and check the list\n`,
      );
    return failed > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`rotate-keys failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
