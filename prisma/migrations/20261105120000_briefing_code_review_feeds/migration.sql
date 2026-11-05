-- 把项目单例简报/代码审查配置迁成可多份的 feed，并折叠同一天的重复历史。

CREATE TABLE "BriefingFeed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyHour" INTEGER NOT NULL DEFAULT 22,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "lastSchedulerSlot" TEXT,
    "lastSchedulerRunAt" DATETIME,
    "lastSchedulerMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BriefingFeed_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BriefingFeedRepository" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BriefingFeedRepository_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "BriefingFeed" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BriefingFeedRepository_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BriefingFeedDeliveryTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedId" TEXT NOT NULL,
    "deliveryTargetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BriefingFeedDeliveryTarget_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "BriefingFeed" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BriefingFeedDeliveryTarget_deliveryTargetId_fkey" FOREIGN KEY ("deliveryTargetId") REFERENCES "DeliveryTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CodeReviewFeed" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyHour" INTEGER NOT NULL DEFAULT 22,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "lastSchedulerSlot" TEXT,
    "lastSchedulerRunAt" DATETIME,
    "lastSchedulerMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodeReviewFeed_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CodeReviewFeedRepository" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeReviewFeedRepository_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "CodeReviewFeed" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodeReviewFeedRepository_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CodeReviewFeedDeliveryTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedId" TEXT NOT NULL,
    "deliveryTargetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeReviewFeedDeliveryTarget_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "CodeReviewFeed" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodeReviewFeedDeliveryTarget_deliveryTargetId_fkey" FOREIGN KEY ("deliveryTargetId") REFERENCES "DeliveryTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BriefingFeed_projectId_name_key" ON "BriefingFeed"("projectId", "name");
CREATE INDEX "BriefingFeed_projectId_idx" ON "BriefingFeed"("projectId");
CREATE INDEX "BriefingFeed_enabled_idx" ON "BriefingFeed"("enabled");
CREATE UNIQUE INDEX "BriefingFeedRepository_feedId_repositoryId_key" ON "BriefingFeedRepository"("feedId", "repositoryId");
CREATE INDEX "BriefingFeedRepository_repositoryId_idx" ON "BriefingFeedRepository"("repositoryId");
CREATE UNIQUE INDEX "BriefingFeedDeliveryTarget_feedId_deliveryTargetId_key" ON "BriefingFeedDeliveryTarget"("feedId", "deliveryTargetId");
CREATE INDEX "BriefingFeedDeliveryTarget_deliveryTargetId_idx" ON "BriefingFeedDeliveryTarget"("deliveryTargetId");

CREATE UNIQUE INDEX "CodeReviewFeed_projectId_name_key" ON "CodeReviewFeed"("projectId", "name");
CREATE INDEX "CodeReviewFeed_projectId_idx" ON "CodeReviewFeed"("projectId");
CREATE INDEX "CodeReviewFeed_enabled_idx" ON "CodeReviewFeed"("enabled");
CREATE UNIQUE INDEX "CodeReviewFeedRepository_feedId_repositoryId_key" ON "CodeReviewFeedRepository"("feedId", "repositoryId");
CREATE INDEX "CodeReviewFeedRepository_repositoryId_idx" ON "CodeReviewFeedRepository"("repositoryId");
CREATE UNIQUE INDEX "CodeReviewFeedDeliveryTarget_feedId_deliveryTargetId_key" ON "CodeReviewFeedDeliveryTarget"("feedId", "deliveryTargetId");
CREATE INDEX "CodeReviewFeedDeliveryTarget_deliveryTargetId_idx" ON "CodeReviewFeedDeliveryTarget"("deliveryTargetId");

INSERT INTO "BriefingFeed" (
    "id", "projectId", "name", "enabled", "dailyHour", "timezone", "autoSend",
    "lastSchedulerSlot", "lastSchedulerRunAt", "lastSchedulerMessage", "createdAt", "updatedAt"
)
SELECT
    lower(hex(randomblob(16))),
    "projectId",
    '默认',
    "enabled",
    "dailyHour",
    "timezone",
    "autoSend",
    "lastSchedulerSlot",
    "lastSchedulerRunAt",
    "lastSchedulerMessage",
    "createdAt",
    "updatedAt"
FROM "ProjectBriefingConfig";

INSERT INTO "BriefingFeed" (
    "id", "projectId", "name", "enabled", "dailyHour", "timezone", "autoSend", "createdAt", "updatedAt"
)
SELECT
    lower(hex(randomblob(16))),
    rows."projectId",
    '默认',
    0,
    22,
    'Asia/Shanghai',
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "projectId" FROM "Briefing") AS rows
WHERE NOT EXISTS (
    SELECT 1 FROM "BriefingFeed" feed WHERE feed."projectId" = rows."projectId"
);

INSERT INTO "CodeReviewFeed" (
    "id", "projectId", "name", "enabled", "dailyHour", "timezone", "autoSend",
    "lastSchedulerSlot", "lastSchedulerRunAt", "lastSchedulerMessage", "createdAt", "updatedAt"
)
SELECT
    lower(hex(randomblob(16))),
    "projectId",
    '默认',
    "enabled",
    "dailyHour",
    "timezone",
    "autoSend",
    "lastSchedulerSlot",
    "lastSchedulerRunAt",
    "lastSchedulerMessage",
    "createdAt",
    "updatedAt"
FROM "ProjectCodeReviewConfig";

INSERT INTO "CodeReviewFeed" (
    "id", "projectId", "name", "enabled", "dailyHour", "timezone", "autoSend", "createdAt", "updatedAt"
)
SELECT
    lower(hex(randomblob(16))),
    rows."projectId",
    '默认',
    0,
    22,
    'Asia/Shanghai',
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "projectId" FROM "DailyCodeReview") AS rows
WHERE NOT EXISTS (
    SELECT 1 FROM "CodeReviewFeed" feed WHERE feed."projectId" = rows."projectId"
);

INSERT INTO "BriefingFeedRepository" ("id", "feedId", "repositoryId", "createdAt")
SELECT lower(hex(randomblob(16))), feed."id", repository."id", CURRENT_TIMESTAMP
FROM "BriefingFeed" feed
JOIN "Project" project ON project."id" = feed."projectId"
JOIN "Repository" repository ON repository."workspaceId" = project."workspaceId";

INSERT INTO "CodeReviewFeedRepository" ("id", "feedId", "repositoryId", "createdAt")
SELECT lower(hex(randomblob(16))), feed."id", repository."id", CURRENT_TIMESTAMP
FROM "CodeReviewFeed" feed
JOIN "Project" project ON project."id" = feed."projectId"
JOIN "Repository" repository ON repository."workspaceId" = project."workspaceId"
WHERE NOT EXISTS (
    SELECT 1 FROM "CodeReviewSource" source
    WHERE source."repositoryId" = repository."id" AND source."isActive" = 0
);

INSERT INTO "BriefingFeedDeliveryTarget" ("id", "feedId", "deliveryTargetId", "createdAt")
SELECT lower(hex(randomblob(16))), feed."id", target."id", CURRENT_TIMESTAMP
FROM "BriefingFeed" feed
JOIN "DeliveryTarget" target ON target."projectId" = feed."projectId"
WHERE target."forBriefing" = 1;

INSERT INTO "CodeReviewFeedDeliveryTarget" ("id", "feedId", "deliveryTargetId", "createdAt")
SELECT lower(hex(randomblob(16))), feed."id", target."id", CURRENT_TIMESTAMP
FROM "CodeReviewFeed" feed
JOIN "DeliveryTarget" target ON target."projectId" = feed."projectId"
WHERE target."forCodeReview" = 1;

ALTER TABLE "Briefing" ADD COLUMN "feedId" TEXT;
ALTER TABLE "DailyCodeReview" ADD COLUMN "feedId" TEXT;

UPDATE "Briefing"
SET "feedId" = (
    SELECT feed."id" FROM "BriefingFeed" feed WHERE feed."projectId" = "Briefing"."projectId"
);

UPDATE "DailyCodeReview"
SET "feedId" = (
    SELECT feed."id" FROM "CodeReviewFeed" feed WHERE feed."projectId" = "DailyCodeReview"."projectId"
);

CREATE TEMP TABLE "briefing_keep" AS
SELECT "id" FROM (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "feedId", "date", "period"
            ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
        ) AS "rn"
    FROM "Briefing"
    WHERE "feedId" IS NOT NULL
) ranked
WHERE ranked."rn" = 1;

DELETE FROM "DeliveryLog"
WHERE "briefingId" IS NOT NULL
  AND "briefingId" NOT IN (SELECT "id" FROM "briefing_keep");

DELETE FROM "Briefing"
WHERE "id" NOT IN (SELECT "id" FROM "briefing_keep");

CREATE TEMP TABLE "code_review_keep" AS
SELECT "id" FROM (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "feedId", "date"
            ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
        ) AS "rn"
    FROM "DailyCodeReview"
    WHERE "feedId" IS NOT NULL
) ranked
WHERE ranked."rn" = 1;

DELETE FROM "DeliveryLog"
WHERE "dailyCodeReviewId" IS NOT NULL
  AND "dailyCodeReviewId" NOT IN (SELECT "id" FROM "code_review_keep");

DELETE FROM "DailyCodeReview"
WHERE "id" NOT IN (SELECT "id" FROM "code_review_keep");

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Briefing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'DAILY',
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "scopeKey" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "markdownContent" TEXT NOT NULL,
    "htmlContent" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" DATETIME,
    "sentAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Briefing_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "BriefingFeed" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Briefing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Briefing_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Briefing" (
    "id", "feedId", "projectId", "workspaceId", "date", "period", "periodStart", "periodEnd",
    "scopeKey", "scope", "status", "markdownContent", "htmlContent", "eventCount",
    "generatedAt", "sentAt", "errorMessage", "createdAt", "updatedAt"
)
SELECT
    "id", "feedId", "projectId", "workspaceId", "date", "period", "periodStart", "periodEnd",
    "scopeKey", "scope", "status", "markdownContent", "htmlContent", "eventCount",
    "generatedAt", "sentAt", "errorMessage", "createdAt", "updatedAt"
FROM "Briefing";

DROP TABLE "Briefing";
ALTER TABLE "new_Briefing" RENAME TO "Briefing";
CREATE UNIQUE INDEX "Briefing_feedId_date_period_key" ON "Briefing"("feedId", "date", "period");
CREATE INDEX "Briefing_projectId_date_idx" ON "Briefing"("projectId", "date");
CREATE INDEX "Briefing_workspaceId_date_idx" ON "Briefing"("workspaceId", "date");
CREATE INDEX "Briefing_projectId_period_periodStart_idx" ON "Briefing"("projectId", "period", "periodStart");

CREATE TABLE "new_DailyCodeReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedId" TEXT NOT NULL,
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
    CONSTRAINT "DailyCodeReview_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "CodeReviewFeed" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DailyCodeReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DailyCodeReview_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_DailyCodeReview" (
    "id", "feedId", "projectId", "workspaceId", "date", "scopeKey", "scope", "status",
    "unitsJson", "markdownContent", "htmlContent", "generatedAt", "sentAt", "errorMessage",
    "createdAt", "updatedAt"
)
SELECT
    "id", "feedId", "projectId", "workspaceId", "date", "scopeKey", "scope", "status",
    "unitsJson", "markdownContent", "htmlContent", "generatedAt", "sentAt", "errorMessage",
    "createdAt", "updatedAt"
FROM "DailyCodeReview";

DROP TABLE "DailyCodeReview";
ALTER TABLE "new_DailyCodeReview" RENAME TO "DailyCodeReview";
CREATE UNIQUE INDEX "DailyCodeReview_feedId_date_key" ON "DailyCodeReview"("feedId", "date");
CREATE INDEX "DailyCodeReview_projectId_date_idx" ON "DailyCodeReview"("projectId", "date");
CREATE INDEX "DailyCodeReview_workspaceId_date_idx" ON "DailyCodeReview"("workspaceId", "date");

DROP TABLE "CodeReviewSource";
DROP TABLE "ProjectBriefingConfig";
DROP TABLE "ProjectCodeReviewConfig";

PRAGMA foreign_keys=ON;
