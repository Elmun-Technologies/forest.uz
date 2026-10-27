-- Phase 4 reports (A1/A2) and attribution: purchasing-session lookups and customer journeys.
CREATE INDEX "Order_sessionId_idx" ON "Order"("sessionId");
CREATE INDEX "Session_customerId_startedAt_idx" ON "Session"("customerId", "startedAt");
