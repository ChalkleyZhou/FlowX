-- CreateTable
CREATE TABLE "RequirementChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requirementId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "sourceWorkflowRunId" TEXT,
    "restartStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RequirementChange_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RequirementChange_sourceWorkflowRunId_fkey" FOREIGN KEY ("sourceWorkflowRunId") REFERENCES "WorkflowRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Requirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "acceptanceCriteria" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "planningStatus" TEXT NOT NULL DEFAULT 'UNSCHEDULED',
    "projectId" TEXT NOT NULL,
    "versionId" TEXT,
    "workspaceId" TEXT,
    "ideationStatus" TEXT NOT NULL DEFAULT 'NONE',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Requirement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProjectVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Requirement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Requirement" ("acceptanceCriteria", "createdAt", "description", "id", "ideationStatus", "planningStatus", "priority", "projectId", "status", "title", "updatedAt", "versionId", "workspaceId") SELECT "acceptanceCriteria", "createdAt", "description", "id", "ideationStatus", "planningStatus", "priority", "projectId", "status", "title", "updatedAt", "versionId", "workspaceId" FROM "Requirement";
DROP TABLE "Requirement";
ALTER TABLE "new_Requirement" RENAME TO "Requirement";
CREATE INDEX "Requirement_projectId_createdAt_idx" ON "Requirement"("projectId", "createdAt");
CREATE INDEX "Requirement_projectId_versionId_idx" ON "Requirement"("projectId", "versionId");
CREATE TABLE "new_WorkflowRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "currentStage" TEXT,
    "runType" TEXT NOT NULL DEFAULT 'FULL',
    "aiProvider" TEXT NOT NULL DEFAULT 'codex',
    "requirementId" TEXT NOT NULL,
    "supersededByChangeId" TEXT,
    "sourceChangeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowRun_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkflowRun_supersededByChangeId_fkey" FOREIGN KEY ("supersededByChangeId") REFERENCES "RequirementChange" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkflowRun_sourceChangeId_fkey" FOREIGN KEY ("sourceChangeId") REFERENCES "RequirementChange" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WorkflowRun" ("aiProvider", "createdAt", "currentStage", "id", "requirementId", "runType", "status", "updatedAt") SELECT "aiProvider", "createdAt", "currentStage", "id", "requirementId", "runType", "status", "updatedAt" FROM "WorkflowRun";
DROP TABLE "WorkflowRun";
ALTER TABLE "new_WorkflowRun" RENAME TO "WorkflowRun";
CREATE UNIQUE INDEX "WorkflowRun_sourceChangeId_key" ON "WorkflowRun"("sourceChangeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RequirementChange_requirementId_createdAt_idx" ON "RequirementChange"("requirementId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementChange_requirementId_requestId_key" ON "RequirementChange"("requirementId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementChange_requirementId_revision_key" ON "RequirementChange"("requirementId", "revision");
