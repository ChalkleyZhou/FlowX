ALTER TABLE "TestCaseSnapshot" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'FUNCTIONAL';
ALTER TABLE "TestCaseSnapshot" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'LIBRARY';

CREATE TABLE "TestDesign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "sourceFingerprint" TEXT NOT NULL,
    "sourceSummary" JSONB NOT NULL,
    "coverageSummary" JSONB,
    "coverageChecks" JSONB,
    "uncoveredItems" JSONB,
    "noCaseReason" TEXT,
    "noSmokeReason" TEXT,
    "staleReason" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestDesign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestDesign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestDesign_projectVersionId_fkey" FOREIGN KEY ("projectVersionId") REFERENCES "ProjectVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TestDesign_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "TestRequest" ADD COLUMN "testDesignId" TEXT REFERENCES "TestDesign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestPlan" ADD COLUMN "testDesignId" TEXT REFERENCES "TestDesign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TestDesignRequirement" (
    "testDesignId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("testDesignId", "requirementId"),
    CONSTRAINT "TestDesignRequirement_testDesignId_fkey" FOREIGN KEY ("testDesignId") REFERENCES "TestDesign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestDesignRequirement_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "TestDesignWorkflowRun" (
    "testDesignId" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("testDesignId", "workflowRunId"),
    CONSTRAINT "TestDesignWorkflowRun_testDesignId_fkey" FOREIGN KEY ("testDesignId") REFERENCES "TestDesign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestDesignWorkflowRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "TestDesignCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testDesignId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceDefinitionId" TEXT,
    "sourceVersion" INTEGER,
    "matchScore" REAL,
    "matchReason" TEXT,
    "coverageKeys" JSONB NOT NULL,
    "proposedCase" JSONB NOT NULL,
    "decisionNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestDesignCandidate_testDesignId_fkey" FOREIGN KEY ("testDesignId") REFERENCES "TestDesign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestDesignCandidate_sourceDefinitionId_fkey" FOREIGN KEY ("sourceDefinitionId") REFERENCES "TestCaseDefinition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "TestDesignSmokeCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testDesignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'P1',
    "precondition" TEXT,
    "steps" JSONB NOT NULL,
    "expected" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "coverageKeys" JSONB NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'PENDING',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestDesignSmokeCase_testDesignId_fkey" FOREIGN KEY ("testDesignId") REFERENCES "TestDesign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TestRequest_testDesignId_key" ON "TestRequest"("testDesignId");
CREATE UNIQUE INDEX "TestPlan_testDesignId_key" ON "TestPlan"("testDesignId");
CREATE UNIQUE INDEX "TestDesign_projectId_projectVersionId_revision_key" ON "TestDesign"("projectId", "projectVersionId", "revision");
CREATE INDEX "TestDesign_workspaceId_status_updatedAt_idx" ON "TestDesign"("workspaceId", "status", "updatedAt");
CREATE INDEX "TestDesign_projectId_projectVersionId_createdAt_idx" ON "TestDesign"("projectId", "projectVersionId", "createdAt");
CREATE INDEX "TestDesignRequirement_requirementId_createdAt_idx" ON "TestDesignRequirement"("requirementId", "createdAt");
CREATE INDEX "TestDesignWorkflowRun_workflowRunId_createdAt_idx" ON "TestDesignWorkflowRun"("workflowRunId", "createdAt");
CREATE INDEX "TestDesignCandidate_testDesignId_resolution_sortOrder_idx" ON "TestDesignCandidate"("testDesignId", "resolution", "sortOrder");
CREATE INDEX "TestDesignCandidate_sourceDefinitionId_idx" ON "TestDesignCandidate"("sourceDefinitionId");
CREATE INDEX "TestDesignSmokeCase_testDesignId_resolution_sortOrder_idx" ON "TestDesignSmokeCase"("testDesignId", "resolution", "sortOrder");
