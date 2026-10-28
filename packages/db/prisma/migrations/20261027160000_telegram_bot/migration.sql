-- Telegram bot (Phase 5A, docs/09, CLAUDE.md §6): bot subscribers, inbox lookups, message meta.
-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN     "meta" JSONB;

-- CreateTable
CREATE TABLE "BotSubscriber" (
    "telegramId" BIGINT NOT NULL,
    "customerId" TEXT,
    "username" TEXT,
    "firstName" TEXT,
    "locale" "Locale",
    "languageCode" TEXT,
    "source" TEXT,
    "utm" JSONB,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phoneSharedAt" TIMESTAMPTZ(3),
    "blockedAt" TIMESTAMPTZ(3),
    "stoppedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BotSubscriber_pkey" PRIMARY KEY ("telegramId")
);

-- CreateIndex
CREATE INDEX "BotSubscriber_customerId_idx" ON "BotSubscriber"("customerId");

-- CreateIndex
CREATE INDEX "BotSubscriber_startedAt_idx" ON "BotSubscriber"("startedAt");

-- CreateIndex
CREATE INDEX "Conversation_telegramChatId_lastMessageAt_idx" ON "Conversation"("telegramChatId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

-- Bot flow switches + complaint keywords (same values as the seed, BOT_COMPLAINT_KEYWORDS).
INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES
  ('bot.rules', '{"scenarios": {"lead": true, "orderStatus": true, "advice": true}, "complaintKeywords": ["shikoyat", "norozi", "yomon", "sifatsiz", "buzilgan", "qaytar", "pulimni", "aldad", "жалоб", "плох", "брак", "обман", "верните", "ужас"]}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
