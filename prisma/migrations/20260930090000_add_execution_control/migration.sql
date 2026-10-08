ALTER TABLE "ExecutionSession" ADD COLUMN "controlMode" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "ExecutionSession" ADD COLUMN "blockedReason" TEXT;
ALTER TABLE "ExecutionSession" ADD COLUMN "cancelRequestedAt" DATETIME;
ALTER TABLE "ExecutionSession" ADD COLUMN "activeControlDeviceKey" TEXT;
CREATE UNIQUE INDEX "ExecutionSession_activeControlDeviceKey_key" ON "ExecutionSession"("activeControlDeviceKey");

CREATE TABLE "ExecutionCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionSessionId" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME,
    "acknowledgedAt" DATETIME,
    "expiresAt" DATETIME,
    "errorMessage" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExecutionCommand_executionSessionId_fkey" FOREIGN KEY ("executionSessionId") REFERENCES "ExecutionSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExecutionCommand_executionSessionId_idempotencyKey_key" ON "ExecutionCommand"("executionSessionId", "idempotencyKey");
CREATE INDEX "ExecutionCommand_executionSessionId_status_issuedAt_idx" ON "ExecutionCommand"("executionSessionId", "status", "issuedAt");
