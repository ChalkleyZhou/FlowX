-- CreateTable
CREATE TABLE "TestRequestScopeCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "testRequestId" TEXT NOT NULL,
    "sourceDefinitionId" TEXT,
    "sourceVersion" INTEGER,
    "libraryId" TEXT,
    "moduleId" TEXT,
    "moduleName" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INCLUDED',
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'P2',
    "precondition" TEXT,
    "testData" TEXT,
    "targetKeys" JSONB,
    "steps" JSONB NOT NULL,
    "expected" TEXT NOT NULL,
    "metadata" JSONB,
    "coverageKeys" JSONB NOT NULL,
    "matchReason" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'LIBRARY',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestRequestScopeCase_testRequestId_fkey" FOREIGN KEY ("testRequestId") REFERENCES "TestRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestRequestScopeCase_sourceDefinitionId_fkey" FOREIGN KEY ("sourceDefinitionId") REFERENCES "TestCaseDefinition" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TestRequestScopeCase_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "TestCaseLibrary" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TestRequestScopeCase_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TestCaseModule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "TestCaseSnapshot" ADD COLUMN "libraryId" TEXT;
ALTER TABLE "TestCaseSnapshot" ADD COLUMN "moduleId" TEXT;
ALTER TABLE "TestCaseSnapshot" ADD COLUMN "moduleName" TEXT;
ALTER TABLE "TestCaseSnapshot" ADD COLUMN "assignedToUserId" TEXT;
ALTER TABLE "TestCaseSnapshot" ADD COLUMN "assignedByUserId" TEXT;
ALTER TABLE "TestCaseSnapshot" ADD COLUMN "assignedAt" DATETIME;

-- CreateIndex
CREATE INDEX "TestRequestScopeCase_testRequestId_status_sortOrder_idx" ON "TestRequestScopeCase"("testRequestId", "status", "sortOrder");
CREATE INDEX "TestRequestScopeCase_sourceDefinitionId_idx" ON "TestRequestScopeCase"("sourceDefinitionId");
CREATE INDEX "TestRequestScopeCase_libraryId_moduleId_idx" ON "TestRequestScopeCase"("libraryId", "moduleId");
CREATE INDEX "TestCaseSnapshot_assignedToUserId_createdAt_idx" ON "TestCaseSnapshot"("assignedToUserId", "createdAt");
