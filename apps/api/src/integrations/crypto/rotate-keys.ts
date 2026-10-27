import type { Prisma, PrismaClient } from '@forest/db';
import type { SecretBox } from './secret-box';

/**
 * Re-seals every value stored with `SecretBox` under an older key with the current
 * APP_ENCRYPTION_KEY (finding F-02, docs/runbooks/secret-rotation.md §1). Idempotent: rows already
 * on the current key are left alone. One short transaction per row, the row locked and re-read
 * inside it, so a concurrent save (new credentials, TOTP enrolment, rotated webhook secret) is
 * never overwritten with the old value. Returns counts only — never secrets or ids.
 */
export interface RotationCounts {
  /** Rows holding a sealed value. */
  sealed: number;
  /** Re-sealed with the current key by this run. */
  rotated: number;
  /** Older key id that none of the configured keys decrypts (or a corrupt envelope). */
  failed: number;
}

export type RotationReport = Record<SealedSource['name'], RotationCounts>;

type Tx = Prisma.TransactionClient;
type Bytes = Uint8Array<ArrayBuffer>;

interface SealedSource {
  name: 'integrationCredentials' | 'staffTotpSecrets' | 'webhookSecrets';
  /** Ids + sealed values (small tables: integrations, staff, webhook endpoints). */
  list(db: PrismaClient): Promise<{ id: string; blob: Uint8Array | null }[]>;
  /** Locks the row and returns its current value. */
  lock(tx: Tx, id: string): Promise<Uint8Array | null>;
  write(tx: Tx, id: string, blob: Bytes): Promise<unknown>;
  aad(id: string): string;
}

type Locked = { blob: Uint8Array | null }[];

/** Every SecretBox user and its AAD (keep in sync with the services that seal). */
const SOURCES: SealedSource[] = [
  {
    name: 'integrationCredentials', // IntegrationsService: AAD = integration key
    list: async (db) =>
      (
        await db.integration.findMany({
          where: { credentials: { not: null } },
          select: { key: true, credentials: true },
        })
      ).map((r) => ({ id: r.key, blob: r.credentials })),
    lock: async (tx, id) =>
      (
        await tx.$queryRaw<Locked>`SELECT "credentials" AS blob FROM "Integration" WHERE "key" = ${id} FOR UPDATE`
      )[0]?.blob ?? null,
    write: (tx, id, blob) =>
      tx.integration.update({ where: { key: id }, data: { credentials: blob } }),
    aad: (id) => id,
  },
  {
    name: 'staffTotpSecrets', // AdminAuthService: `totpAad(id)`
    list: async (db) =>
      (
        await db.staff.findMany({
          where: { totpSecret: { not: null } },
          select: { id: true, totpSecret: true },
        })
      ).map((r) => ({ id: r.id, blob: r.totpSecret })),
    lock: async (tx, id) =>
      (
        await tx.$queryRaw<Locked>`SELECT "totpSecret" AS blob FROM "Staff" WHERE "id" = ${id} FOR UPDATE`
      )[0]?.blob ?? null,
    write: (tx, id, blob) => tx.staff.update({ where: { id }, data: { totpSecret: blob } }),
    aad: (id) => `staff-totp:${id}`,
  },
  {
    name: 'webhookSecrets', // WebhookSecrets: `webhook:<id>`
    list: async (db) =>
      (await db.webhookEndpoint.findMany({ select: { id: true, secret: true } })).map((r) => ({
        id: r.id,
        blob: r.secret,
      })),
    lock: async (tx, id) =>
      (
        await tx.$queryRaw<Locked>`SELECT "secret" AS blob FROM "WebhookEndpoint" WHERE "id" = ${id} FOR UPDATE`
      )[0]?.blob ?? null,
    write: (tx, id, blob) => tx.webhookEndpoint.update({ where: { id }, data: { secret: blob } }),
    aad: (id) => `webhook:${id}`,
  },
];

export async function rotateSealedSecrets(
  db: PrismaClient,
  box: SecretBox,
): Promise<RotationReport> {
  const report = {} as RotationReport;
  for (const source of SOURCES) {
    const counts: RotationCounts = { sealed: 0, rotated: 0, failed: 0 };
    for (const row of await source.list(db)) {
      // Empty = nothing sealed (migrated webhook rows waiting for a new secret).
      if (!row.blob || row.blob.length === 0) continue;
      counts.sealed++;
      if (!box.needsRotation(row.blob)) continue;
      const outcome = await db.$transaction(async (tx) => {
        const blob = await source.lock(tx, row.id);
        if (!blob || blob.length === 0 || !box.needsRotation(blob)) return 'skipped' as const;
        let plain: Buffer;
        try {
          plain = box.decrypt(blob, source.aad(row.id));
        } catch {
          return 'failed' as const;
        }
        await source.write(tx, row.id, new Uint8Array(box.encrypt(plain, source.aad(row.id))));
        return 'rotated' as const;
      });
      if (outcome === 'rotated') counts.rotated++;
      if (outcome === 'failed') counts.failed++;
    }
    report[source.name] = counts;
  }
  return report;
}
