PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

ATTACH DATABASE '/Users/chalkley/workspace/FlowX/prisma/dev.db' AS legacy;

INSERT INTO Workspace (id, status, name, description, createdAt, updatedAt)
SELECT id, status, name, description, createdAt, updatedAt
FROM legacy.Workspace;

INSERT INTO Workspace (id, status, name, description, createdAt, updatedAt)
SELECT
  'migrated-unassigned-workspace',
  'ACTIVE',
  '历史迁移工作区',
  '用于承接旧数据里未绑定工作区的需求',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM legacy.Requirement
  WHERE workspaceId IS NULL OR TRIM(workspaceId) = ''
);

INSERT INTO Project (id, status, workspaceId, name, code, description, createdAt, updatedAt)
SELECT
  'project_' || id,
  'ACTIVE',
  id,
  name || ' 默认项目',
  NULL,
  '旧模型迁移时自动创建的默认项目',
  createdAt,
  updatedAt
FROM legacy.Workspace;

INSERT INTO Project (id, status, workspaceId, name, code, description, createdAt, updatedAt)
SELECT
  'migrated-unassigned-project',
  'ACTIVE',
  'migrated-unassigned-workspace',
  '历史未归档需求',
  NULL,
  '用于承接旧数据里未绑定工作区的需求',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM legacy.Requirement
  WHERE workspaceId IS NULL OR TRIM(workspaceId) = ''
);

INSERT INTO Repository (
  id, status, workspaceId, name, url, defaultBranch, currentBranch,
  localPath, syncStatus, syncError, lastSyncedAt, createdAt, updatedAt
)
SELECT
  id, status, workspaceId, name, url, defaultBranch, currentBranch,
  localPath, syncStatus, syncError, lastSyncedAt, createdAt, updatedAt
FROM legacy.Repository;

INSERT INTO User (id, account, email, displayName, avatarUrl, status, createdAt, updatedAt)
SELECT id, account, email, displayName, avatarUrl, status, createdAt, updatedAt
FROM legacy.User;

INSERT INTO LocalCredential (id, userId, account, passwordHash, createdAt, updatedAt)
SELECT id, userId, account, passwordHash, createdAt, updatedAt
FROM legacy.LocalCredential;

INSERT INTO AuthIdentity (
  id, userId, provider, providerUserId, providerUnionId,
  providerRawProfile, lastLoginAt, createdAt, updatedAt
)
SELECT
  id, userId, provider, providerUserId, providerUnionId,
  providerRawProfile, lastLoginAt, createdAt, updatedAt
FROM legacy.AuthIdentity;

INSERT INTO Organization (
  id, provider, providerOrganizationId, name, logoUrl, createdAt, updatedAt
)
SELECT
  id, provider, providerOrganizationId, name, logoUrl, createdAt, updatedAt
FROM legacy.Organization;

INSERT INTO UserOrganization (
  id, userId, organizationId, role, createdAt, updatedAt
)
SELECT
  id, userId, organizationId, role, createdAt, updatedAt
FROM legacy.UserOrganization;

INSERT INTO UserSession (
  id, token, userId, organizationId, expiresAt, createdAt, updatedAt
)
SELECT
  id, token, userId, organizationId, expiresAt, createdAt, updatedAt
FROM legacy.UserSession;

INSERT INTO OAuthState (
  id, provider, state, redirectUri, expiresAt, usedAt, createdAt, updatedAt
)
SELECT
  id, provider, state, redirectUri, expiresAt, usedAt, createdAt, updatedAt
FROM legacy.OAuthState;

INSERT INTO PendingOrganizationSelection (
  id, token, provider, profile, organizations, expiresAt, consumedAt, createdAt, updatedAt
)
SELECT
  id, token, provider, profile, organizations, expiresAt, consumedAt, createdAt, updatedAt
FROM legacy.PendingOrganizationSelection;

INSERT INTO Requirement (
  id, status, title, description, acceptanceCriteria,
  projectId, workspaceId, createdAt, updatedAt
)
SELECT
  id,
  status,
  title,
  description,
  acceptanceCriteria,
  CASE
    WHEN workspaceId IS NULL OR TRIM(workspaceId) = '' THEN 'migrated-unassigned-project'
    ELSE 'project_' || workspaceId
  END,
  CASE
    WHEN workspaceId IS NULL OR TRIM(workspaceId) = '' THEN 'migrated-unassigned-workspace'
    ELSE workspaceId
  END,
  createdAt,
  updatedAt
FROM legacy.Requirement;

INSERT INTO WorkflowRun (
  id, status, currentStage, requirementId, createdAt, updatedAt
)
SELECT
  id, status, currentStage, requirementId, createdAt, updatedAt
FROM legacy.WorkflowRun;

INSERT INTO WorkflowRepository (
  id, workflowRunId, repositoryId, name, url, baseBranch, workingBranch,
  localPath, status, syncError, preparedAt, createdAt, updatedAt
)
SELECT
  id, workflowRunId, repositoryId, name, url, baseBranch, workingBranch,
  localPath, status, syncError, preparedAt, createdAt, updatedAt
FROM legacy.WorkflowRepository;

INSERT INTO StageExecution (
  id, workflowRunId, stage, attempt, status, statusMessage, input, output,
  errorMessage, startedAt, finishedAt, createdAt, updatedAt
)
SELECT
  id, workflowRunId, stage, attempt, status, statusMessage, input, output,
  errorMessage, startedAt, finishedAt, createdAt, updatedAt
FROM legacy.StageExecution;

INSERT INTO Task (
  id, workflowRunId, title, description, "order", status, createdAt, updatedAt
)
SELECT
  id, workflowRunId, title, description, "order", status, createdAt, updatedAt
FROM legacy.Task;

INSERT INTO Plan (
  id, workflowRunId, status, summary, implementationPlan,
  filesToModify, newFiles, riskPoints, createdAt, updatedAt
)
SELECT
  id, workflowRunId, status, summary, implementationPlan,
  filesToModify, newFiles, riskPoints, createdAt, updatedAt
FROM legacy.Plan;

INSERT INTO CodeExecution (
  id, workflowRunId, status, patchSummary, changedFiles,
  codeChanges, diffArtifacts, createdAt, updatedAt
)
SELECT
  id, workflowRunId, status, patchSummary, changedFiles,
  codeChanges, diffArtifacts, createdAt, updatedAt
FROM legacy.CodeExecution;

INSERT INTO ReviewReport (
  id, workflowRunId, status, issues, bugs, missingTests,
  suggestions, impactScope, createdAt, updatedAt
)
SELECT
  id, workflowRunId, status, issues, bugs, missingTests,
  suggestions, impactScope, createdAt, updatedAt
FROM legacy.ReviewReport;

INSERT INTO Issue (
  id, status, priority, title, description, resolution,
  workspaceId, requirementId, workflowRunId, repositoryId,
  branchName, assigneeUserId, reportedByUserId, createdAt, updatedAt
)
SELECT
  id, status, priority, title, description, resolution,
  CASE
    WHEN workspaceId IS NULL OR TRIM(workspaceId) = '' THEN 'migrated-unassigned-workspace'
    ELSE workspaceId
  END,
  requirementId, workflowRunId, repositoryId,
  branchName, assigneeUserId, reportedByUserId, createdAt, updatedAt
FROM legacy.Issue;

INSERT INTO Bug (
  id, status, severity, priority, title, description,
  expectedBehavior, actualBehavior, reproductionSteps, resolution,
  workspaceId, requirementId, workflowRunId, repositoryId, branchName,
  fixRequirementId, assigneeUserId, reportedByUserId, createdAt, updatedAt
)
SELECT
  id, status, severity, priority, title, description,
  expectedBehavior, actualBehavior, reproductionSteps, resolution,
  CASE
    WHEN workspaceId IS NULL OR TRIM(workspaceId) = '' THEN 'migrated-unassigned-workspace'
    ELSE workspaceId
  END,
  requirementId, workflowRunId, repositoryId, branchName,
  fixRequirementId, assigneeUserId, reportedByUserId, createdAt, updatedAt
FROM legacy.Bug;

INSERT INTO ReviewFinding (
  id, status, type, sourceType, sourceIndex, severity, title, description,
  recommendation, impactScope, metadata, reviewReportId, workflowRunId,
  sourceStageExecutionId, convertedIssueId, convertedBugId, createdAt, updatedAt
)
SELECT
  id, status, type, sourceType, sourceIndex, severity, title, description,
  recommendation, impactScope, metadata, reviewReportId, workflowRunId,
  sourceStageExecutionId, convertedIssueId, convertedBugId, createdAt, updatedAt
FROM legacy.ReviewFinding;

COMMIT;
DETACH DATABASE legacy;
PRAGMA foreign_keys = ON;
