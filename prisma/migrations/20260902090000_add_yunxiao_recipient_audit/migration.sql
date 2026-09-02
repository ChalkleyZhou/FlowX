CREATE TABLE "YunxiaoWebhookRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "projectId" TEXT,
    "recipientKey" TEXT NOT NULL,
    "yunxiaoUserIdentifier" TEXT,
    "yunxiaoDisplayName" TEXT NOT NULL,
    "roles" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "dingTalkId" TEXT,
    "matchedUserId" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "YunxiaoWebhookRecipient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "YunxiaoWebhookRecipient_matchedUserId_fkey" FOREIGN KEY ("matchedUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "YunxiaoWebhookRecipient_organizationId_eventId_recipientKey_key"
  ON "YunxiaoWebhookRecipient"("organizationId", "eventId", "recipientKey");
CREATE INDEX "YunxiaoWebhookRecipient_organizationId_status_lastSeenAt_idx"
  ON "YunxiaoWebhookRecipient"("organizationId", "status", "lastSeenAt");
CREATE INDEX "YunxiaoWebhookRecipient_organizationId_lastSeenAt_idx"
  ON "YunxiaoWebhookRecipient"("organizationId", "lastSeenAt");
