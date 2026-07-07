-- CreateTable
CREATE TABLE "DailyCodeReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "unitsJson" JSONB NOT NULL,
    "markdownContent" TEXT NOT NULL,
    "htmlContent" TEXT NOT NULL,
    "generatedAt" DATETIME,
    "sentAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyCodeReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DailyCodeReview_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DeliveryLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "briefingId" TEXT,
    "dailyCodeReviewId" TEXT,
    "deliveryTargetId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "providerResponse" JSONB,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryLog_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "Briefing" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DeliveryLog_dailyCodeReviewId_fkey" FOREIGN KEY ("dailyCodeReviewId") REFERENCES "DailyCodeReview" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DeliveryLog_deliveryTargetId_fkey" FOREIGN KEY ("deliveryTargetId") REFERENCES "DeliveryTarget" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DeliveryLog" ("id", "briefingId", "deliveryTargetId", "channel", "status", "errorMessage", "providerResponse", "sentAt", "createdAt") SELECT "id", "briefingId", "deliveryTargetId", "channel", "status", "errorMessage", "providerResponse", "sentAt", "createdAt" FROM "DeliveryLog";
DROP TABLE "DeliveryLog";
ALTER TABLE "new_DeliveryLog" RENAME TO "DeliveryLog";
CREATE INDEX "DeliveryLog_briefingId_idx" ON "DeliveryLog"("briefingId");
CREATE INDEX "DeliveryLog_deliveryTargetId_idx" ON "DeliveryLog"("deliveryTargetId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- AlterTable
ALTER TABLE "ProjectBriefingConfig" ADD COLUMN "lastCodeReviewSchedulerSlot" TEXT;
ALTER TABLE "ProjectBriefingConfig" ADD COLUMN "lastCodeReviewSchedulerRunAt" DATETIME;
ALTER TABLE "ProjectBriefingConfig" ADD COLUMN "lastCodeReviewSchedulerMessage" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DailyCodeReview_projectId_scopeKey_key" ON "DailyCodeReview"("projectId", "scopeKey");
CREATE INDEX "DailyCodeReview_projectId_date_idx" ON "DailyCodeReview"("projectId", "date");
CREATE INDEX "DailyCodeReview_workspaceId_date_idx" ON "DailyCodeReview"("workspaceId", "date");
