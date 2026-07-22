-- CreateTable
CREATE TABLE "ExecutionSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowRunId" TEXT NOT NULL,
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
    CONSTRAINT "ExecutionSession_stageExecutionId_fkey" FOREIGN KEY ("stageExecutionId") REFERENCES "StageExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExecutionSession_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "executionSessionId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "sequence" INTEGER,
    "eventType" TEXT NOT NULL,
    "sourceTool" TEXT NOT NULL,
    "actorId" TEXT,
    "deviceId" TEXT,
    "traceId" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    CONSTRAINT "SyncEvent_executionSessionId_fkey" FOREIGN KEY ("executionSessionId") REFERENCES "ExecutionSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "workflowRunId" TEXT,
    "executionSessionId" TEXT,
    "artifactType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1',
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "storageKey" TEXT,
    "externalUrl" TEXT,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Artifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Artifact_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Artifact_executionSessionId_fkey" FOREIGN KEY ("executionSessionId") REFERENCES "ExecutionSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Artifact_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionSessionId" TEXT NOT NULL,
    "artifactId" TEXT,
    "evidenceType" TEXT NOT NULL,
    "sourceTool" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REPORTED',
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Evidence_executionSessionId_fkey" FOREIGN KEY ("executionSessionId") REFERENCES "ExecutionSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Evidence_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionSession_traceId_key" ON "ExecutionSession"("traceId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionSession_idempotencyKey_key" ON "ExecutionSession"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ExecutionSession_workflowRunId_status_createdAt_idx" ON "ExecutionSession"("workflowRunId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionSession_stageExecutionId_status_idx" ON "ExecutionSession"("stageExecutionId", "status");

-- CreateIndex
CREATE INDEX "ExecutionSession_organizationId_status_createdAt_idx" ON "ExecutionSession"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionSession_workspaceId_status_createdAt_idx" ON "ExecutionSession"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionSession_projectId_status_createdAt_idx" ON "ExecutionSession"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionSession_claimedByUserId_createdAt_idx" ON "ExecutionSession"("claimedByUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncEvent_eventId_key" ON "SyncEvent"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncEvent_idempotencyKey_key" ON "SyncEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SyncEvent_executionSessionId_occurredAt_idx" ON "SyncEvent"("executionSessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "SyncEvent_traceId_occurredAt_idx" ON "SyncEvent"("traceId", "occurredAt");

-- CreateIndex
CREATE INDEX "SyncEvent_eventType_occurredAt_idx" ON "SyncEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "Artifact_workspaceId_artifactType_createdAt_idx" ON "Artifact"("workspaceId", "artifactType", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_projectId_createdAt_idx" ON "Artifact"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_workflowRunId_artifactType_createdAt_idx" ON "Artifact"("workflowRunId", "artifactType", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_executionSessionId_artifactType_createdAt_idx" ON "Artifact"("executionSessionId", "artifactType", "createdAt");

-- CreateIndex
CREATE INDEX "Artifact_sha256_idx" ON "Artifact"("sha256");

-- CreateIndex
CREATE INDEX "Artifact_createdByUserId_createdAt_idx" ON "Artifact"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Evidence_executionSessionId_evidenceType_occurredAt_idx" ON "Evidence"("executionSessionId", "evidenceType", "occurredAt");

-- CreateIndex
CREATE INDEX "Evidence_artifactId_createdAt_idx" ON "Evidence"("artifactId", "createdAt");

-- CreateIndex
CREATE INDEX "Evidence_status_occurredAt_idx" ON "Evidence"("status", "occurredAt");
