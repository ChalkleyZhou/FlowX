-- AlterTable
ALTER TABLE "TestCaseDefinition" ADD COLUMN "targetKeys" JSONB;

-- AlterTable
ALTER TABLE "TestDesign" ADD COLUMN "caseSelection" JSONB;
ALTER TABLE "TestDesign" ADD COLUMN "retrievalSummary" JSONB;

-- AlterTable
ALTER TABLE "TestCaseSnapshot" ADD COLUMN "targetKeys" JSONB;

-- CreateTable
CREATE TABLE "QualityProgressEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testExecutionId" TEXT NOT NULL,
    "executionSessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QualityProgressEvent_testExecutionId_fkey" FOREIGN KEY ("testExecutionId") REFERENCES "TestExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QualityTestReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QualityTestReport_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TestRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QualityTestReport_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "QualityTestReport_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testPlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "runType" TEXT NOT NULL DEFAULT 'INITIAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceFingerprint" TEXT,
    "reportRevision" INTEGER NOT NULL DEFAULT 0,
    "executionMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "revision" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_TestRun" ("completedAt", "createdAt", "createdByUserId", "id", "name", "reportRevision", "runType", "sourceBugId", "sourceFingerprint", "startedAt", "status", "testPlanId", "updatedAt") SELECT "completedAt", "createdAt", "createdByUserId", "id", "name", "reportRevision", "runType", "sourceBugId", "sourceFingerprint", "startedAt", "status", "testPlanId", "updatedAt" FROM "TestRun";
DROP TABLE "TestRun";
ALTER TABLE "new_TestRun" RENAME TO "TestRun";
CREATE INDEX "TestRun_testPlanId_createdAt_idx" ON "TestRun"("testPlanId", "createdAt");
CREATE INDEX "TestRun_sourceBugId_createdAt_idx" ON "TestRun"("sourceBugId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "QualityProgressEvent_executionSessionId_idempotencyKey_key" ON "QualityProgressEvent"("executionSessionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "QualityTestReport_runId_createdAt_idx" ON "QualityTestReport"("runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QualityTestReport_requestId_kind_revision_key" ON "QualityTestReport"("requestId", "kind", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "QualityTestReport_requestId_idempotencyKey_key" ON "QualityTestReport"("requestId", "idempotencyKey");
