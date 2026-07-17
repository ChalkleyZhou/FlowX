-- CreateTable
CREATE TABLE "ProjectCodeReviewConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyHour" INTEGER NOT NULL DEFAULT 22,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "lastSchedulerSlot" TEXT,
    "lastSchedulerRunAt" DATETIME,
    "lastSchedulerMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectCodeReviewConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCodeReviewConfig_projectId_key" ON "ProjectCodeReviewConfig"("projectId");

-- DataMigration: seed ProjectCodeReviewConfig from existing ProjectBriefingConfig rows,
-- carrying over the shared schedule fields and mapping the legacy CR scheduler status
-- columns onto their new independent home.
INSERT INTO "ProjectCodeReviewConfig" (
    "id",
    "projectId",
    "enabled",
    "dailyHour",
    "timezone",
    "autoSend",
    "lastSchedulerSlot",
    "lastSchedulerRunAt",
    "lastSchedulerMessage",
    "createdAt",
    "updatedAt"
)
SELECT
    lower(hex(randomblob(16))),
    "projectId",
    "enabled",
    "dailyHour",
    "timezone",
    "autoSend",
    "lastCodeReviewSchedulerSlot",
    "lastCodeReviewSchedulerRunAt",
    "lastCodeReviewSchedulerMessage",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ProjectBriefingConfig";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProjectBriefingConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyHour" INTEGER NOT NULL DEFAULT 22,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "lastSchedulerSlot" TEXT,
    "lastSchedulerRunAt" DATETIME,
    "lastSchedulerMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectBriefingConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProjectBriefingConfig" ("id", "projectId", "enabled", "dailyHour", "timezone", "autoSend", "lastSchedulerSlot", "lastSchedulerRunAt", "lastSchedulerMessage", "createdAt", "updatedAt") SELECT "id", "projectId", "enabled", "dailyHour", "timezone", "autoSend", "lastSchedulerSlot", "lastSchedulerRunAt", "lastSchedulerMessage", "createdAt", "updatedAt" FROM "ProjectBriefingConfig";
DROP TABLE "ProjectBriefingConfig";
ALTER TABLE "new_ProjectBriefingConfig" RENAME TO "ProjectBriefingConfig";
CREATE UNIQUE INDEX "ProjectBriefingConfig_projectId_key" ON "ProjectBriefingConfig"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
