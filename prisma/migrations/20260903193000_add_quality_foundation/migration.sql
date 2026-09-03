-- CreateTable
CREATE TABLE "TestCaseLibrary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestCaseLibrary_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestCaseLibrary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestCaseLibrary_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestCaseModule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestCaseModule_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "TestCaseLibrary" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestCaseModule_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TestCaseModule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestCaseDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryId" TEXT NOT NULL,
    "moduleId" TEXT,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "precondition" TEXT,
    "steps" JSONB NOT NULL,
    "expected" TEXT NOT NULL,
    "tags" JSONB,
    "metadata" JSONB,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestCaseDefinition_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "TestCaseLibrary" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestCaseDefinition_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TestCaseModule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TestCaseDefinition_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestCaseCoverageLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testCaseDefinitionId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "confidence" REAL,
    "evidence" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestCaseCoverageLink_testCaseDefinitionId_fkey" FOREIGN KEY ("testCaseDefinitionId") REFERENCES "TestCaseDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectVersionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scopeGenerationStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "scopeSummary" TEXT,
    "scopeRevision" INTEGER NOT NULL DEFAULT 0,
    "scopeChecks" JSONB,
    "excludedScopes" JSONB,
    "traceId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestRequest_projectVersionId_fkey" FOREIGN KEY ("projectVersionId") REFERENCES "ProjectVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TestRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestRequestRequirement" (
    "testRequestId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("testRequestId", "requirementId"),
    CONSTRAINT "TestRequestRequirement_testRequestId_fkey" FOREIGN KEY ("testRequestId") REFERENCES "TestRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestRequestRequirement_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestRequestWorkflowRun" (
    "testRequestId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("testRequestId", "workflowRunId"),
    CONSTRAINT "TestRequestWorkflowRun_testRequestId_fkey" FOREIGN KEY ("testRequestId") REFERENCES "TestRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestRequestWorkflowRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestRequestArtifact" (
    "testRequestId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("testRequestId", "artifactId"),
    CONSTRAINT "TestRequestArtifact_testRequestId_fkey" FOREIGN KEY ("testRequestId") REFERENCES "TestRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestRequestArtifact_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testRequestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestPlan_testRequestId_fkey" FOREIGN KEY ("testRequestId") REFERENCES "TestRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestPlan_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestCaseSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testPlanId" TEXT NOT NULL,
    "sourceDefinitionId" TEXT,
    "sourceVersion" INTEGER,
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "precondition" TEXT,
    "steps" JSONB NOT NULL,
    "expected" TEXT NOT NULL,
    "metadata" JSONB,
    "selectedBy" TEXT NOT NULL DEFAULT 'AI',
    "selectionReason" TEXT,
    "impactLevel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestCaseSnapshot_testPlanId_fkey" FOREIGN KEY ("testPlanId") REFERENCES "TestPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestCaseSnapshot_sourceDefinitionId_fkey" FOREIGN KEY ("sourceDefinitionId") REFERENCES "TestCaseDefinition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testPlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "runType" TEXT NOT NULL DEFAULT 'INITIAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceBugId" TEXT,
    "createdByUserId" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestRun_testPlanId_fkey" FOREIGN KEY ("testPlanId") REFERENCES "TestPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestRun_sourceBugId_fkey" FOREIGN KEY ("sourceBugId") REFERENCES "Bug" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TestRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestRunCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testRunId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestRunCase_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestRunCase_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TestCaseSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TestRunCase_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testRunCaseId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "actualResult" TEXT,
    "remark" TEXT,
    "evidence" JSONB,
    "bugId" TEXT,
    "executedByUserId" TEXT,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestResult_testRunCaseId_fkey" FOREIGN KEY ("testRunCaseId") REFERENCES "TestRunCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestResult_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TestResult_executedByUserId_fkey" FOREIGN KEY ("executedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TestCaseLibrary_workspaceId_scope_status_idx" ON "TestCaseLibrary"("workspaceId", "scope", "status");

-- CreateIndex
CREATE INDEX "TestCaseLibrary_projectId_status_idx" ON "TestCaseLibrary"("projectId", "status");

-- CreateIndex
CREATE INDEX "TestCaseModule_libraryId_sortOrder_idx" ON "TestCaseModule"("libraryId", "sortOrder");

-- CreateIndex
CREATE INDEX "TestCaseModule_parentId_idx" ON "TestCaseModule"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseModule_libraryId_parentId_name_key" ON "TestCaseModule"("libraryId", "parentId", "name");

-- CreateIndex
CREATE INDEX "TestCaseDefinition_libraryId_status_updatedAt_idx" ON "TestCaseDefinition"("libraryId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "TestCaseDefinition_moduleId_status_idx" ON "TestCaseDefinition"("moduleId", "status");

-- CreateIndex
CREATE INDEX "TestCaseDefinition_externalId_idx" ON "TestCaseDefinition"("externalId");

-- CreateIndex
CREATE INDEX "TestCaseCoverageLink_targetType_targetKey_idx" ON "TestCaseCoverageLink"("targetType", "targetKey");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseCoverageLink_testCaseDefinitionId_targetType_targetKey_key" ON "TestCaseCoverageLink"("testCaseDefinitionId", "targetType", "targetKey");

-- CreateIndex
CREATE UNIQUE INDEX "TestRequest_traceId_key" ON "TestRequest"("traceId");

-- CreateIndex
CREATE INDEX "TestRequest_workspaceId_status_createdAt_idx" ON "TestRequest"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TestRequest_projectId_projectVersionId_createdAt_idx" ON "TestRequest"("projectId", "projectVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "TestRequestRequirement_requirementId_createdAt_idx" ON "TestRequestRequirement"("requirementId", "createdAt");

-- CreateIndex
CREATE INDEX "TestRequestWorkflowRun_workflowRunId_createdAt_idx" ON "TestRequestWorkflowRun"("workflowRunId", "createdAt");

-- CreateIndex
CREATE INDEX "TestRequestArtifact_artifactId_createdAt_idx" ON "TestRequestArtifact"("artifactId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestPlan_testRequestId_key" ON "TestPlan"("testRequestId");

-- CreateIndex
CREATE INDEX "TestCaseSnapshot_testPlanId_createdAt_idx" ON "TestCaseSnapshot"("testPlanId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseSnapshot_testPlanId_sourceDefinitionId_sourceVersion_key" ON "TestCaseSnapshot"("testPlanId", "sourceDefinitionId", "sourceVersion");

-- CreateIndex
CREATE INDEX "TestRun_testPlanId_createdAt_idx" ON "TestRun"("testPlanId", "createdAt");

-- CreateIndex
CREATE INDEX "TestRun_sourceBugId_createdAt_idx" ON "TestRun"("sourceBugId", "createdAt");

-- CreateIndex
CREATE INDEX "TestRunCase_assignedToUserId_createdAt_idx" ON "TestRunCase"("assignedToUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestRunCase_testRunId_snapshotId_key" ON "TestRunCase"("testRunId", "snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "TestResult_testRunCaseId_key" ON "TestResult"("testRunCaseId");

-- CreateIndex
CREATE INDEX "TestResult_result_executedAt_idx" ON "TestResult"("result", "executedAt");

-- CreateIndex
CREATE INDEX "TestResult_bugId_createdAt_idx" ON "TestResult"("bugId", "createdAt");
