-- 缺陷统一为 WorkItem(kind=BUG)。保留旧 Bug 表仅用于历史数据迁移和已有数据库升级，业务读写统一切到 WorkItem。
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

ALTER TABLE "WorkItem" ADD COLUMN "fixWorkItemId" TEXT;
ALTER TABLE "WorkItem" ADD COLUMN "fixWorkflowRunId" TEXT;
ALTER TABLE "TestRun" ADD COLUMN "sourceWorkItemId" TEXT;
ALTER TABLE "TestResult" ADD COLUMN "workItemId" TEXT;

INSERT OR IGNORE INTO "Project" ("id", "status", "workspaceId", "name", "description", "createdAt", "updatedAt")
SELECT 'bug-migration-project-' || b."workspaceId", 'ACTIVE', b."workspaceId", '缺陷池', '缺陷统一为 WorkItem 时创建的默认项目', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Bug" b
WHERE b."projectId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Project" p WHERE p."workspaceId" = b."workspaceId" AND p."name" = '缺陷池');

INSERT OR IGNORE INTO "WorkItem" (
  "id", "kind", "status", "title", "description", "priority", "resolution", "severity",
  "expectedBehavior", "actualBehavior", "reproductionSteps", "screenshots", "branchName",
  "projectId", "workspaceId", "reportedByUserId", "assigneeUserId", "repositoryId",
  "sourceWorkflowRunId", "fixWorkItemId", "fixWorkflowRunId", "createdAt", "updatedAt"
)
SELECT
  b."id", 'BUG', b."status", b."title", b."description", b."priority", b."resolution", b."severity",
  b."expectedBehavior", b."actualBehavior", b."reproductionSteps", b."screenshots", b."branchName",
  COALESCE(b."projectId", 'bug-migration-project-' || b."workspaceId"), b."workspaceId", b."reportedByUserId", b."assigneeUserId", b."repositoryId",
  b."workflowRunId", b."fixWorkItemId", b."fixWorkflowRunId", b."createdAt", b."updatedAt"
FROM "Bug" b;

UPDATE "ReviewFinding" SET "convertedWorkItemId" = "convertedBugId"
WHERE "convertedWorkItemId" IS NULL AND "convertedBugId" IS NOT NULL;
UPDATE "TestRun" SET "sourceWorkItemId" = "sourceBugId"
WHERE "sourceWorkItemId" IS NULL AND "sourceBugId" IS NOT NULL;
UPDATE "TestResult" SET "workItemId" = "bugId"
WHERE "workItemId" IS NULL AND "bugId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "WorkItem_fixWorkflowRunId_key" ON "WorkItem"("fixWorkflowRunId");
CREATE INDEX IF NOT EXISTS "WorkItem_fixWorkItemId_idx" ON "WorkItem"("fixWorkItemId");
CREATE INDEX IF NOT EXISTS "TestRun_sourceWorkItemId_createdAt_idx" ON "TestRun"("sourceWorkItemId", "createdAt");
CREATE INDEX IF NOT EXISTS "TestResult_workItemId_createdAt_idx" ON "TestResult"("workItemId", "createdAt");

COMMIT;
PRAGMA foreign_keys=ON;
