PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ExecutionSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowRunId" TEXT,
    "testRunId" TEXT,
    "stageExecutionId" TEXT,
    "organizationId" TEXT,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "deviceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "executorType" TEXT NOT NULL,
    "sourceTool" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "claimedByUserId" TEXT,
    "startedAt" DATETIME,
    "lastHeartbeatAt" DATETIME,
    "completedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "summary" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExecutionSession_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_stageExecutionId_fkey" FOREIGN KEY ("stageExecutionId") REFERENCES "StageExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_ExecutionSession" ("claimedByUserId", "completedAt", "createdAt", "deviceId", "errorCode", "errorMessage", "executorType", "id", "idempotencyKey", "lastHeartbeatAt", "metadata", "organizationId", "projectId", "protocolVersion", "sourceTool", "stageExecutionId", "startedAt", "status", "summary", "traceId", "updatedAt", "workflowRunId", "workspaceId")
SELECT "claimedByUserId", "completedAt", "createdAt", "deviceId", "errorCode", "errorMessage", "executorType", "id", "idempotencyKey", "lastHeartbeatAt", "metadata", "organizationId", "projectId", "protocolVersion", "sourceTool", "stageExecutionId", "startedAt", "status", "summary", "traceId", "updatedAt", "workflowRunId", "workspaceId" FROM "ExecutionSession";

DROP TABLE "ExecutionSession";
ALTER TABLE "new_ExecutionSession" RENAME TO "ExecutionSession";

ALTER TABLE "TestRun" ADD COLUMN "sourceFingerprint" TEXT;
ALTER TABLE "TestRun" ADD COLUMN "reportRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "TestRunTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testRunId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "expectedRevisions" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestRunTarget_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "TestRunCase" ADD COLUMN "targetId" TEXT REFERENCES "TestRunTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestRunCase" ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TestRunCase" ADD COLUMN "blocking" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "TestExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testRunId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "executionSessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "claimedCaseIds" JSONB NOT NULL,
    "claimedByUserId" TEXT,
    "deviceId" TEXT,
    "sourceFingerprint" TEXT NOT NULL,
    "testedRevisions" JSONB,
    "environment" JSONB,
    "summary" TEXT,
    "leaseExpiresAt" DATETIME NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestExecution_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestExecution_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "TestRunTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestExecution_executionSessionId_fkey" FOREIGN KEY ("executionSessionId") REFERENCES "ExecutionSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestExecution_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "TestExecutionCaseResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testExecutionId" TEXT NOT NULL,
    "testRunCaseId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "durationMs" INTEGER,
    "actualResult" TEXT,
    "remark" TEXT,
    "artifactIds" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestExecutionCaseResult_testExecutionId_fkey" FOREIGN KEY ("testExecutionId") REFERENCES "TestExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestExecutionCaseResult_testRunCaseId_fkey" FOREIGN KEY ("testRunCaseId") REFERENCES "TestRunCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TestRunCaseLease" (
    "testRunCaseId" TEXT NOT NULL PRIMARY KEY,
    "testExecutionId" TEXT NOT NULL,
    "leaseExpiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestRunCaseLease_testRunCaseId_fkey" FOREIGN KEY ("testRunCaseId") REFERENCES "TestRunCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestRunCaseLease_testExecutionId_fkey" FOREIGN KEY ("testExecutionId") REFERENCES "TestExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ExecutionSession_traceId_key" ON "ExecutionSession"("traceId");
CREATE UNIQUE INDEX "ExecutionSession_idempotencyKey_key" ON "ExecutionSession"("idempotencyKey");
CREATE INDEX "ExecutionSession_workflowRunId_status_createdAt_idx" ON "ExecutionSession"("workflowRunId", "status", "createdAt");
CREATE INDEX "ExecutionSession_testRunId_status_createdAt_idx" ON "ExecutionSession"("testRunId", "status", "createdAt");
CREATE INDEX "ExecutionSession_stageExecutionId_status_idx" ON "ExecutionSession"("stageExecutionId", "status");
CREATE INDEX "ExecutionSession_organizationId_status_createdAt_idx" ON "ExecutionSession"("organizationId", "status", "createdAt");
CREATE INDEX "ExecutionSession_workspaceId_status_createdAt_idx" ON "ExecutionSession"("workspaceId", "status", "createdAt");
CREATE INDEX "ExecutionSession_projectId_status_createdAt_idx" ON "ExecutionSession"("projectId", "status", "createdAt");
CREATE INDEX "ExecutionSession_claimedByUserId_createdAt_idx" ON "ExecutionSession"("claimedByUserId", "createdAt");
CREATE UNIQUE INDEX "TestRunTarget_testRunId_key_key" ON "TestRunTarget"("testRunId", "key");
CREATE INDEX "TestRunTarget_testRunId_status_idx" ON "TestRunTarget"("testRunId", "status");
DROP INDEX "TestRunCase_testRunId_snapshotId_key";
CREATE UNIQUE INDEX "TestRunCase_testRunId_snapshotId_targetId_key" ON "TestRunCase"("testRunId", "snapshotId", "targetId");
CREATE UNIQUE INDEX "TestRunCase_legacy_testRunId_snapshotId_key" ON "TestRunCase"("testRunId", "snapshotId") WHERE "targetId" IS NULL;
CREATE INDEX "TestRunCase_targetId_sortOrder_idx" ON "TestRunCase"("targetId", "sortOrder");
CREATE UNIQUE INDEX "TestExecution_executionSessionId_key" ON "TestExecution"("executionSessionId");
CREATE INDEX "TestExecution_testRunId_status_createdAt_idx" ON "TestExecution"("testRunId", "status", "createdAt");
CREATE INDEX "TestExecution_targetId_status_leaseExpiresAt_idx" ON "TestExecution"("targetId", "status", "leaseExpiresAt");
CREATE INDEX "TestExecution_claimedByUserId_status_createdAt_idx" ON "TestExecution"("claimedByUserId", "status", "createdAt");
CREATE INDEX "TestRunCaseLease_testExecutionId_leaseExpiresAt_idx" ON "TestRunCaseLease"("testExecutionId", "leaseExpiresAt");
CREATE UNIQUE INDEX "TestExecutionCaseResult_testExecutionId_testRunCaseId_key" ON "TestExecutionCaseResult"("testExecutionId", "testRunCaseId");
CREATE INDEX "TestExecutionCaseResult_testRunCaseId_result_createdAt_idx" ON "TestExecutionCaseResult"("testRunCaseId", "result", "createdAt");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
