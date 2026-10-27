-- Phase 5 (CLAUDE.md §6): outbound webhooks (endpoint + outbox) and partner API keys.

-- WebhookEndpoint had no writer before Phase 5, but rows are kept if any exist: the old
-- plain-text secret can't be sealed with the app's SecretBox in SQL, so it is dropped and such
-- rows are switched off with an empty sealed secret until the Owner rotates it (admin refuses
-- to re-enable an endpoint without a secret). Non-destructive for url/events.
ALTER TABLE "WebhookEndpoint"
  ADD COLUMN "name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "secretLast4" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "disabledAt" TIMESTAMPTZ(3),
  ADD COLUMN "disabledReason" TEXT,
  ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "WebhookEndpoint"
  SET "active" = false,
      "disabledAt" = CURRENT_TIMESTAMP,
      "disabledReason" = 'migration: rotate the signing secret before enabling';
ALTER TABLE "WebhookEndpoint" DROP COLUMN "secret";
ALTER TABLE "WebhookEndpoint" ADD COLUMN "secret" BYTEA NOT NULL DEFAULT '\x'::bytea;
ALTER TABLE "WebhookEndpoint" ALTER COLUMN "secret" DROP DEFAULT;

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "durationMs" INTEGER,
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventKey_key" ON "WebhookDelivery"("endpointId", "eventKey");
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "scopes" TEXT[],
    "rateLimitPerMin" INTEGER NOT NULL DEFAULT 60,
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" TEXT,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- Ilhom article listing (kind + locale + published) — Page is read by kind on every storefront hit.
CREATE INDEX IF NOT EXISTS "Page_kind_locale_published_idx" ON "Page"("kind", "locale", "published");
