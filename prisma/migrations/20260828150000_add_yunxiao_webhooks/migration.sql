-- CreateTable
CREATE TABLE "YunxiaoWebhookConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "YunxiaoWebhookConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "YunxiaoWebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
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
    CONSTRAINT "YunxiaoWebhookDelivery_configId_fkey" FOREIGN KEY ("configId") REFERENCES "YunxiaoWebhookConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "YunxiaoWebhookDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "YunxiaoWebhookDelivery_matchedUserId_fkey" FOREIGN KEY ("matchedUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "YunxiaoWebhookConfig_organizationId_key" ON "YunxiaoWebhookConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "YunxiaoWebhookDelivery_configId_eventId_key" ON "YunxiaoWebhookDelivery"("configId", "eventId");

-- CreateIndex
CREATE INDEX "YunxiaoWebhookDelivery_organizationId_createdAt_idx" ON "YunxiaoWebhookDelivery"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "YunxiaoWebhookDelivery_matchedUserId_createdAt_idx" ON "YunxiaoWebhookDelivery"("matchedUserId", "createdAt");

-- CreateIndex
CREATE INDEX "YunxiaoWebhookDelivery_status_createdAt_idx" ON "YunxiaoWebhookDelivery"("status", "createdAt");
