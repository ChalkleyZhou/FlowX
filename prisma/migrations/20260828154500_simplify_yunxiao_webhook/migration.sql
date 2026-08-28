-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_YunxiaoWebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "recipient" JSONB NOT NULL,
    "matchedUserId" TEXT,
    "matchedBy" TEXT,
    "title" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "linkUrl" TEXT,
    "rawPayload" JSONB NOT NULL,
    "providerResponse" JSONB,
    "errorMessage" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "YunxiaoWebhookDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "YunxiaoWebhookDelivery_matchedUserId_fkey" FOREIGN KEY ("matchedUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_YunxiaoWebhookDelivery" (
    "id",
    "organizationId",
    "eventId",
    "status",
    "recipient",
    "matchedUserId",
    "matchedBy",
    "title",
    "markdown",
    "linkUrl",
    "rawPayload",
    "providerResponse",
    "errorMessage",
    "sentAt",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "organizationId",
    "eventId",
    "status",
    "recipient",
    "matchedUserId",
    "matchedBy",
    "title",
    "markdown",
    "linkUrl",
    "rawPayload",
    "providerResponse",
    "errorMessage",
    "sentAt",
    "createdAt",
    "updatedAt"
FROM "YunxiaoWebhookDelivery";
DROP TABLE "YunxiaoWebhookDelivery";
ALTER TABLE "new_YunxiaoWebhookDelivery" RENAME TO "YunxiaoWebhookDelivery";
CREATE UNIQUE INDEX "YunxiaoWebhookDelivery_organizationId_eventId_key" ON "YunxiaoWebhookDelivery"("organizationId", "eventId");
CREATE INDEX "YunxiaoWebhookDelivery_organizationId_createdAt_idx" ON "YunxiaoWebhookDelivery"("organizationId", "createdAt");
CREATE INDEX "YunxiaoWebhookDelivery_matchedUserId_createdAt_idx" ON "YunxiaoWebhookDelivery"("matchedUserId", "createdAt");
CREATE INDEX "YunxiaoWebhookDelivery_status_createdAt_idx" ON "YunxiaoWebhookDelivery"("status", "createdAt");
DROP TABLE "YunxiaoWebhookConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
