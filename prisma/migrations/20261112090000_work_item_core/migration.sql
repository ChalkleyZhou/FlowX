-- WorkItem is the only business root. This cutover is intentionally destructive
-- to the old Requirement/Issue tables: data is copied into WorkItem first and
-- all dependent tables receive their new workItemId before db push rebuilds them.
-- The application uses db push for SQLite upgrades; this SQL is also used by the
-- Docker pre-db-push hook so an existing database keeps its history.
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS "WorkItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL DEFAULT 'REQUIREMENT',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "acceptanceCriteria" TEXT NOT NULL DEFAULT '',
  "functionalModule" TEXT NOT NULL DEFAULT '',
  "riskImpact" TEXT NOT NULL DEFAULT '',
  "productRequirementDocument" TEXT NOT NULL DEFAULT '',
  "remark" TEXT NOT NULL DEFAULT '',
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "planningStatus" TEXT NOT NULL DEFAULT 'UNSCHEDULED',
  "ideationStatus" TEXT NOT NULL DEFAULT 'NONE',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "resolution" TEXT,
  "severity" TEXT,
  "expectedBehavior" TEXT,
  "actualBehavior" TEXT,
  "reproductionSteps" JSONB,
  "screenshots" JSONB,
  "branchName" TEXT,
  "projectId" TEXT NOT NULL,
  "versionId" TEXT,
  "workspaceId" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "assigneeUserId" TEXT,
  "reportedByUserId" TEXT,
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "repositoryId" TEXT,
  "sourceWorkflowRunId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProjectVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkItem_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkItem_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkItem_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WorkItem_sourceWorkflowRunId_fkey" FOREIGN KEY ("sourceWorkflowRunId") REFERENCES "WorkflowRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WorkItem_projectId_versionId_updatedAt_id_idx" ON "WorkItem" ("projectId", "versionId", "updatedAt", "id");
CREATE INDEX IF NOT EXISTS "WorkItem_workspaceId_kind_status_updatedAt_idx" ON "WorkItem" ("workspaceId", "kind", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "WorkItem_ownerUserId_status_updatedAt_idx" ON "WorkItem" ("ownerUserId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "WorkItem_sourceWorkflowRunId_createdAt_idx" ON "WorkItem" ("sourceWorkflowRunId", "createdAt");

-- An orphan Issue still needs a valid project because WorkItem.projectId is
-- required. Create one deterministic project per affected workspace only when
-- that workspace has no project yet.
INSERT OR IGNORE INTO "Project" ("id", "status", "workspaceId", "name", "description", "createdAt", "updatedAt")
SELECT 'work-item-migration-project-' || w."id", 'ACTIVE', w."id", '历史工作项', '工作项根模型切换时创建', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Workspace" w
WHERE NOT EXISTS (SELECT 1 FROM "Project" p WHERE p."workspaceId" = w."id")
  AND EXISTS (SELECT 1 FROM "Issue" i WHERE i."workspaceId" = w."id");

-- Requirement rows become REQUIREMENT work items with the same identifiers.
INSERT OR IGNORE INTO "WorkItem" (
  "id", "projectId", "versionId", "workspaceId", "kind", "title", "description",
  "acceptanceCriteria", "functionalModule", "riskImpact", "productRequirementDocument",
  "remark", "status", "priority", "planningStatus", "ideationStatus", "revision",
  "createdByUserId", "createdByName", "createdAt", "updatedAt"
)
SELECT r."id", r."projectId", r."versionId",
  COALESCE(r."workspaceId", p."workspaceId"), 'REQUIREMENT', r."title", r."description",
  r."acceptanceCriteria", r."functionalModule", r."riskImpact", r."productRequirementDocument",
  r."remark", r."status", r."priority", r."planningStatus", r."ideationStatus", r."revision",
  r."createdByUserId", r."createdByName", r."createdAt", r."updatedAt"
FROM "Requirement" r
JOIN "Project" p ON p."id" = r."projectId";

-- Issue rows become ISSUE work items. Existing issue-to-requirement and
-- issue-to-workflow links are retained as project/sourceWorkflow context.
INSERT OR IGNORE INTO "WorkItem" (
  "id", "projectId", "versionId", "workspaceId", "kind", "title", "description", "resolution",
  "status", "priority", "assigneeUserId", "reportedByUserId", "repositoryId", "branchName",
  "sourceWorkflowRunId", "createdAt", "updatedAt"
)
SELECT i."id",
  COALESCE(r."projectId", wrReq."projectId", p."id"),
  r."versionId", i."workspaceId", 'ISSUE', i."title", i."description", i."resolution",
  i."status", i."priority", i."assigneeUserId", i."reportedByUserId", i."repositoryId",
  i."branchName", i."workflowRunId", i."createdAt", i."updatedAt"
FROM "Issue" i
LEFT JOIN "Requirement" r ON r."id" = i."requirementId"
LEFT JOIN "WorkflowRun" wr ON wr."id" = i."workflowRunId"
LEFT JOIN "Requirement" wrReq ON wrReq."id" = wr."requirementId"
JOIN "Project" p ON p."id" = COALESCE(r."projectId", wrReq."projectId", (SELECT p2."id" FROM "Project" p2 WHERE p2."workspaceId" = i."workspaceId" ORDER BY p2."createdAt" ASC LIMIT 1));

-- The quality links now point to the unified WorkItem root. Rename the
-- physical link tables in the same cutover so no compatibility table remains.
ALTER TABLE "TestDesignRequirement" RENAME TO "TestDesignWorkItem";
ALTER TABLE "TestRequestRequirement" RENAME TO "TestRequestWorkItem";

-- Add the new FK names before db push rebuilds these tables. SQLite has no
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so the hook executes this file only
-- while the legacy Requirement table is present.
ALTER TABLE "WorkflowRun" ADD COLUMN "workItemId" TEXT;
UPDATE "WorkflowRun" SET "workItemId" = "requirementId" WHERE "requirementId" IS NOT NULL;

ALTER TABLE "RequirementChange" ADD COLUMN "workItemId" TEXT;
UPDATE "RequirementChange" SET "workItemId" = "requirementId" WHERE "requirementId" IS NOT NULL;

ALTER TABLE "RequirementAssignment" ADD COLUMN "workItemId" TEXT;
UPDATE "RequirementAssignment" SET "workItemId" = "requirementId" WHERE "requirementId" IS NOT NULL;

ALTER TABLE "RequirementRepository" ADD COLUMN "workItemId" TEXT;
UPDATE "RequirementRepository" SET "workItemId" = "requirementId" WHERE "requirementId" IS NOT NULL;

ALTER TABLE "IdeationSession" ADD COLUMN "workItemId" TEXT;
UPDATE "IdeationSession" SET "workItemId" = "requirementId" WHERE "requirementId" IS NOT NULL;

ALTER TABLE "IdeationArtifact" ADD COLUMN "workItemId" TEXT;
UPDATE "IdeationArtifact" SET "workItemId" = "requirementId" WHERE "requirementId" IS NOT NULL;

ALTER TABLE "PrototypeImport" ADD COLUMN "workItemId" TEXT;
UPDATE "PrototypeImport" SET "workItemId" = "requirementId" WHERE "requirementId" IS NOT NULL;

ALTER TABLE "TestDesignWorkItem" ADD COLUMN "workItemId" TEXT;
UPDATE "TestDesignWorkItem" SET "workItemId" = "requirementId" WHERE "requirementId" IS NOT NULL;

ALTER TABLE "TestRequestWorkItem" ADD COLUMN "workItemId" TEXT;
UPDATE "TestRequestWorkItem" SET "workItemId" = "requirementId" WHERE "requirementId" IS NOT NULL;

ALTER TABLE "ReviewFinding" ADD COLUMN "convertedWorkItemId" TEXT;
UPDATE "ReviewFinding" SET "convertedWorkItemId" = "convertedIssueId" WHERE "convertedIssueId" IS NOT NULL;

ALTER TABLE "Bug" ADD COLUMN "workItemId" TEXT;
UPDATE "Bug" SET "workItemId" = "requirementId" WHERE "requirementId" IS NOT NULL;
ALTER TABLE "Bug" ADD COLUMN "fixWorkItemId" TEXT;
UPDATE "Bug" SET "fixWorkItemId" = "fixRequirementId" WHERE "fixRequirementId" IS NOT NULL;
UPDATE "TestCaseCoverageLink" SET "targetType" = 'WORK_ITEM' WHERE "targetType" = 'REQUIREMENT';

-- Execution plans and items are created during the cutover so a deployment can
-- start producing execution work immediately after db push completes.
CREATE TABLE IF NOT EXISTS "ExecutionPlan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workItemId" TEXT NOT NULL,
  "workflowRunId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "strategy" TEXT NOT NULL DEFAULT 'SINGLE',
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ExecutionPlan_workItemId_status_createdAt_idx" ON "ExecutionPlan" ("workItemId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ExecutionPlan_workflowRunId_idx" ON "ExecutionPlan" ("workflowRunId");

CREATE TABLE IF NOT EXISTS "ExecutionItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "executionPlanId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "target" TEXT NOT NULL DEFAULT 'LOCAL',
  "ownerUserId" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "claimKey" TEXT,
  "claimedAt" DATETIME,
  "completedAt" DATETIME,
  "completionSummary" TEXT,
  "completionEvidence" JSONB,
  "blockedReason" TEXT,
  "cancelledAt" DATETIME,
  "cancelReason" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "dependsOnIds" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ExecutionItem_executionPlanId_status_sortOrder_idx" ON "ExecutionItem" ("executionPlanId", "status", "sortOrder");
CREATE INDEX IF NOT EXISTS "ExecutionItem_ownerUserId_status_updatedAt_idx" ON "ExecutionItem" ("ownerUserId", "status", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ExecutionItem_claimKey_key" ON "ExecutionItem" ("claimKey");

-- Existing roots also receive the final execution contract. A migrated item
-- starts as one confirmed local execution item; later edits may replace this
-- plan with an AI or manual split before a new workflow starts.
INSERT OR IGNORE INTO "ExecutionPlan" (
  "id", "workItemId", "workflowRunId", "status", "strategy", "createdAt", "updatedAt"
)
SELECT 'work-item-migration-plan-' || w."id", w."id", NULL, 'CONFIRMED', 'SINGLE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WorkItem" w
WHERE NOT EXISTS (SELECT 1 FROM "ExecutionPlan" p WHERE p."workItemId" = w."id");

INSERT OR IGNORE INTO "ExecutionItem" (
  "id", "executionPlanId", "title", "description", "target", "required", "status", "sortOrder", "createdAt", "updatedAt"
)
SELECT 'work-item-migration-execution-' || w."id", p."id", w."title", w."description", 'LOCAL', 1, 'READY', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WorkItem" w
JOIN "ExecutionPlan" p ON p."id" = 'work-item-migration-plan-' || w."id";

-- Preserve the latest workflow binding so existing active work can continue
-- through the same plan. Older workflow history remains attached to WorkItem.
UPDATE "ExecutionPlan"
SET "workflowRunId" = (
  SELECT wr."id"
  FROM "WorkflowRun" wr
  WHERE wr."workItemId" = "ExecutionPlan"."workItemId"
  ORDER BY wr."createdAt" DESC, wr."id" DESC
  LIMIT 1
)
WHERE "id" LIKE 'work-item-migration-plan-%';

ALTER TABLE "ExecutionSession" ADD COLUMN "executionItemId" TEXT;
UPDATE "ExecutionSession"
SET "executionItemId" = (
  SELECT ei."id"
  FROM "ExecutionItem" ei
  JOIN "ExecutionPlan" ep ON ep."id" = ei."executionPlanId"
  WHERE ep."workflowRunId" = "ExecutionSession"."workflowRunId"
  ORDER BY ei."sortOrder" ASC, ei."id" ASC
  LIMIT 1
)
WHERE "workflowRunId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "ExecutionSession_executionItemId_status_createdAt_idx" ON "ExecutionSession" ("executionItemId", "status", "createdAt");

-- The old roots no longer exist after this point. Prisma db push sees the new
-- workItemId columns, preserves their data while rebuilding affected tables,
-- and enforces the final non-null/foreign-key contracts from schema.prisma.
DROP TABLE IF EXISTS "Issue";
DROP TABLE IF EXISTS "Requirement";

COMMIT;
PRAGMA foreign_keys=ON;
