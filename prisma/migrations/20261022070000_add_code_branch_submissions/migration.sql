CREATE TABLE "CodeBranchSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowRunId" TEXT NOT NULL,
    "stageExecutionId" TEXT NOT NULL,
    "workflowRepositoryId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodeBranchSubmission_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodeBranchSubmission_stageExecutionId_fkey" FOREIGN KEY ("stageExecutionId") REFERENCES "StageExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodeBranchSubmission_workflowRepositoryId_fkey" FOREIGN KEY ("workflowRepositoryId") REFERENCES "WorkflowRepository" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CodeBranchSubmission_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CodeBranchSubmission_stageExecutionId_workflowRepositoryId_branch_submittedByUserId_key" ON "CodeBranchSubmission"("stageExecutionId", "workflowRepositoryId", "branch", "submittedByUserId");
CREATE INDEX "CodeBranchSubmission_workflowRunId_stageExecutionId_idx" ON "CodeBranchSubmission"("workflowRunId", "stageExecutionId");
