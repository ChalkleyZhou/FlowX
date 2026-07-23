export interface RequirementScheduleSummary {
  assignmentCount: number;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  totalEstimatedDays: number;
}

export interface RequirementAssignment {
  id: string;
  userId: string;
  role: string;
  plannedStartDate: string;
  plannedEndDate: string;
  sortOrder: number;
  colorToken?: string | null;
  note?: string | null;
  estimatedDays?: number;
  estimatedHours?: number;
  user?: {
    id: string;
    displayName: string;
    avatarUrl?: string | null;
  };
}

export interface OrganizationMember {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  account?: string | null;
  email?: string | null;
  role?: string;
  status?: string;
  joinedAt?: string;
}

export interface GanttLane {
  id: string;
  kind: 'requirement' | 'member';
  parentLaneId?: string;
  label: string;
  meta: Record<string, string | undefined>;
}

export interface GanttBar {
  id: string;
  laneId: string;
  label: string;
  start: string;
  end: string;
  estimatedDays: number;
  estimatedHours: number;
  color?: string;
  meta: {
    projectId: string;
    requirementId: string;
    userId: string;
    role: string;
  };
}

export interface GanttPayload {
  view: 'requirement' | 'member';
  range: { from: string; to: string };
  lanes: GanttLane[];
  bars: GanttBar[];
}

export interface Project {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  workspace: Workspace;
  requirements?: Array<
    Requirement & {
      scheduleSummary?: RequirementScheduleSummary;
    }
  >;
  _count?: {
    requirements: number;
  };
}

export interface RepositoryDeployConfig {
  id?: string | null;
  repositoryId: string;
  enabled: boolean;
  provider: string;
  configJson?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface DeployJobRecord {
  id: string;
  projectId?: string | null;
  repositoryId?: string | null;
  workflowRunId?: string | null;
  provider: string;
  status: string;
  targetEnv?: string | null;
  branch?: string | null;
  commitSha?: string | null;
  version?: string | null;
  versionImage?: string | null;
  image?: string | null;
  externalJobId?: string | null;
  externalJobUrl?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BriefingSource {
  id: string;
  workspaceId: string;
  repositoryId: string;
  provider: 'github' | 'gitlab';
  externalPath: string;
  externalId?: string | null;
  webhookSecret?: string;
  isActive: boolean;
  workspace?: Workspace;
  repository?: Repository;
  createdAt?: string;
  updatedAt?: string;
}

export interface CodeReviewSource {
  id: string;
  workspaceId: string;
  repositoryId: string;
  isActive: boolean;
  workspace?: Workspace;
  repository?: Repository;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectBriefingConfig {
  id?: string;
  projectId: string;
  enabled: boolean;
  dailyHour: number;
  timezone: string;
  autoSend: boolean;
  lastSchedulerSlot?: string | null;
  lastSchedulerRunAt?: string | null;
  lastSchedulerMessage?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ProjectCodeReviewConfig {
  id?: string;
  projectId: string;
  enabled: boolean;
  dailyHour: number;
  timezone: string;
  autoSend: boolean;
  lastSchedulerSlot?: string | null;
  lastSchedulerRunAt?: string | null;
  lastSchedulerMessage?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface DailyCodeReviewUnit {
  repositoryName: string;
  repositoryId: string | null;
  ref: string;
  commits: Array<{ id: string; message: string; author?: string }>;
  status: string;
  skillHint?: string;
  errorMessage?: string;
  findings?: {
    issues: string[];
    bugs: string[];
    missingTests: string[];
    suggestions: string[];
    impactScope: string[];
  };
}

export interface DailyCodeReview {
  id: string;
  projectId: string;
  workspaceId: string;
  date: string;
  scopeKey: string;
  scope: Record<string, unknown>;
  status: string;
  unitsJson: DailyCodeReviewUnit[];
  markdownContent: string;
  htmlContent: string;
  generatedAt?: string | null;
  sentAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  deliveryLogs?: DeliveryLog[];
}

export interface DeliveryTarget {
  id: string;
  projectId: string;
  type: 'EMAIL' | 'DINGTALK_ROBOT' | 'DINGTALK_APP' | string;
  name: string;
  userId?: string | null;
  organizationId?: string | null;
  emailAddress?: string | null;
  dingtalkWebhookUrl?: string | null;
  dingtalkSecret?: string | null;
  isActive: boolean;
  forBriefing: boolean;
  forCodeReview: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DeliveryLog {
  id: string;
  briefingId?: string | null;
  dailyCodeReviewId?: string | null;
  deliveryTargetId: string;
  channel: string;
  status: string;
  errorMessage?: string | null;
  providerResponse?: unknown;
  sentAt?: string | null;
  createdAt: string;
  deliveryTarget?: DeliveryTarget;
}

export type BriefingPeriod = 'DAILY' | 'WEEKLY';

export interface Briefing {
  id: string;
  projectId: string;
  workspaceId: string;
  date: string;
  period: BriefingPeriod;
  periodStart?: string | null;
  periodEnd?: string | null;
  scopeKey: string;
  scope: {
    period?: BriefingPeriod;
    date?: string;
    rangeLabel?: string;
    periodStart?: string;
    periodEnd?: string;
    projectId?: string;
    workspaceId?: string;
    repositoryIds?: string[];
    briefingSourceIds?: string[];
  } | Record<string, unknown>;
  status: string;
  markdownContent: string;
  htmlContent: string;
  eventCount: number;
  generatedAt?: string | null;
  sentAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  project?: Project;
  workspace?: Workspace;
  deliveryLogs?: DeliveryLog[];
}

export interface LocalDevDetectResponse {
  repositoryId: string;
  localPath: string;
  cwd: string;
  packageManager: 'pnpm' | 'npm' | 'yarn';
  scriptName: string;
  shellCommand: string;
}

export interface LocalDevPreviewStatus {
  repositoryId: string;
  running: boolean;
  status: 'idle' | 'starting' | 'running' | 'failed' | 'stopped';
  previewUrl?: string;
  port?: number;
  cwd?: string;
  shellCommand?: string;
  logTail?: string;
  lastError?: string;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority?: string;
  planningStatus?: string;
  ideationStatus: string;
  project: Project;
  assignments?: RequirementAssignment[];
  workspace?: Workspace | null;
  ideationSessions?: IdeationSession[];
  ideationArtifacts?: IdeationArtifact[];
  workflowRuns?: Array<{
    id: string;
    status: string;
    workflowRepositories?: Array<{
      id: string;
      name: string;
      repositoryId?: string | null;
      status: string;
    }>;
  }>;
  requirementRepositories?: Array<{
    id: string;
    repository: Repository;
  }>;
}

export interface Repository {
  id: string;
  name: string;
  url: string;
  deployConfig?: RepositoryDeployConfig | null;
  defaultBranch?: string | null;
  currentBranch?: string | null;
  localPath?: string | null;
  syncStatus?: string;
  syncError?: string | null;
  lastSyncedAt?: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string | null;
  repositories: Repository[];
  _count?: {
    projects: number;
    requirements: number;
  };
}

export interface StageExecution {
  id: string;
  stage: string;
  status: string;
  statusMessage?: string | null;
  attempt: number;
  input?: unknown;
  output: unknown;
}

export interface WorkflowDesignArtifact {
  exists: boolean;
  html: string | null;
  generatedAt?: string;
}

export interface WorkflowRun {
  id: string;
  status: string;
  runType?: string;
  aiProvider: 'codex' | 'cursor';
  fixForBug?: { id: string; title: string; status: string } | null;
  requirement: Requirement;
  workflowRepositories: Array<{
    id: string;
    repositoryId?: string | null;
    name: string;
    url: string;
    baseBranch: string;
    workingBranch: string;
    localPath?: string | null;
    status: string;
    syncError?: string | null;
    preparedAt?: string | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    surface?: string | null;
    repositoryNames?: string[];
    status: string;
  }>;
  plan?: {
    summary: string;
    implementationPlan: string[];
    filesToModify: string[];
    newFiles: string[];
    riskPoints: string[];
    status: string;
  };
  codeExecution?: {
    patchSummary: string;
    changedFiles: string[];
    codeChanges: unknown[];
    diffArtifacts?: Array<{
      repository: string;
      branch: string;
      localPath: string;
      diffStat: string;
      diffText: string;
      untrackedFiles: string[];
    }>;
    status: string;
  };
  reviewReport?: {
    id: string;
    issues: string[];
    bugs: string[];
    missingTests: string[];
    suggestions: string[];
    impactScope: string[];
    status: string;
  };
  reviewFindings: ReviewFinding[];
  stageExecutions: StageExecution[];
}

export interface LocalHandoffCheckoutHints {
  fetch: string;
  checkout: string;
  push: string;
}

export interface LocalHandoffRepository {
  workflowRepositoryId: string;
  repositoryId: string | null;
  name: string;
  url: string;
  baseBranch: string;
  workingBranch: string;
  checkout: LocalHandoffCheckoutHints;
  suggestedCommitMessage: string;
}

export interface LocalHandoffPayload {
  workflowRunId: string;
  executionSessionId?: string | null;
  status: string;
  executor: 'LOCAL';
  requirement: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
  };
  plan: {
    summary: string;
    implementationPlan: string[];
    filesToModify: string[];
    newFiles: string[];
    riskPoints: string[];
  };
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    surface: string | null;
    repositoryNames: string[];
  }>;
  repositories: LocalHandoffRepository[];
  artifacts: {
    planMetaPath: string | null;
    planHtmlPath: string | null;
  };
}

export interface LocalExecutionClaimResponse {
  workflow: WorkflowRun;
  handoff: LocalHandoffPayload;
}

export interface OpenDesignHandoff {
  protocolVersion: string;
  workflowRunId: string;
  executionSessionId: string;
  traceId: string;
  completionEndpoint: string;
  contextPackage: {
    protocolVersion: string;
    generatedAt: string;
    sourceTool: 'opendesign';
    workflowRunId: string;
    executionSessionId: string;
    traceId: string;
    requirement: {
      id: string;
      title: string;
      description: string;
      acceptanceCriteria: string;
    };
    repositories: Array<{
      repositoryId: string;
      workflowRepositoryId?: string;
      name: string;
      url: string | null;
      baseBranch?: string;
      workingBranch?: string;
    }>;
    outputContract: {
      resultFileName: string;
      format: 'flowx-design-result-v1';
      requiredFields: readonly string[];
    };
  };
}

export interface OpenDesignHandoffResponse {
  workflow: WorkflowRun;
  handoff: OpenDesignHandoff;
  ticket: string;
  loopbackPort: number;
}

export interface CompleteLocalRepositoryReport {
  workflowRepositoryId: string;
  headSha: string;
  changedFiles: string[];
  patchSummary?: string;
}

export interface ReviewFinding {
  id: string;
  status: string;
  type: string;
  sourceType: string;
  sourceIndex: number;
  severity: string;
  title: string;
  description: string;
  recommendation?: string | null;
  impactScope?: string[] | null;
  convertedIssueId?: string | null;
  convertedBugId?: string | null;
}

export interface Issue {
  id: string;
  status: string;
  priority: string;
  title: string;
  description: string;
  workspace?: { id: string; name: string } | null;
  requirement?: { id: string; title: string } | null;
  workflowRun?: { id: string; status: string } | null;
  workflowRunId?: string | null;
  requirementId?: string | null;
  branchName?: string | null;
  createdAt?: string;
  resolution?: string | null;
  reviewFinding?: {
    id: string;
    type: string;
    severity: string;
    title: string;
    description: string;
  } | null;
}

export interface BugScreenshot {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Bug {
  id: string;
  status: string;
  severity: string;
  priority: string;
  title: string;
  description: string;
  screenshots?: BugScreenshot[] | null;
  workspace?: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
  projectId?: string | null;
  requirement?: { id: string; title: string } | null;
  workflowRun?: { id: string; status: string } | null;
  fixWorkflowRun?: { id: string; status: string } | null;
  fixRequirement?: { id: string; title: string } | null;
  workflowRunId?: string | null;
  fixWorkflowRunId?: string | null;
  requirementId?: string | null;
  branchName?: string | null;
  createdAt?: string;
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
  reproductionSteps?: string[] | null;
  resolution?: string | null;
  reviewFinding?: {
    id: string;
    type: string;
    severity: string;
    title: string;
    description: string;
  } | null;
}

export interface AuthOrganization {
  id: string;
  name: string;
  providerOrganizationId?: string;
  logoUrl?: string;
  role?: string | null;
}

export interface AuthUser {
  id: string;
  email?: string;
  displayName: string;
  avatarUrl?: string;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AuthUser;
  organization: AuthOrganization | null;
}

export interface AiCredentialStatus {
  provider: 'cursor' | 'codex';
  configured: boolean;
  updatedAt?: string;
}

export interface GitCredentialStatus {
  provider: 'github' | 'gitlab';
  configured: boolean;
  updatedAt?: string;
}

export type ExecutionSessionStatus =
  | 'CREATED'
  | 'CLAIMED'
  | 'RUNNING'
  | 'COMPLETING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type ExecutorType = 'LOCAL' | 'CLOUD' | 'CI';

export type SourceTool =
  | 'cursor'
  | 'codex'
  | 'opendesign'
  | 'shell'
  | 'test-runner'
  | 'flowx-worker';

export interface ExecutionSessionDetail {
  id: string;
  workflowRunId: string;
  stageExecutionId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  deviceId?: string | null;
  status: ExecutionSessionStatus;
  executorType: ExecutorType;
  sourceTool: SourceTool;
  protocolVersion: string;
  traceId: string;
  idempotencyKey?: string | null;
  claimedByUserId?: string | null;
  startedAt?: string | null;
  lastHeartbeatAt?: string | null;
  completedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  syncEvents?: ExecutionSessionSyncEvent[];
  artifacts?: ExecutionSessionArtifact[];
  evidence?: ExecutionSessionEvidence[];
}

export type EvidenceType =
  | 'GIT_COMMIT'
  | 'REMOTE_BRANCH_VERIFICATION'
  | 'CHANGED_FILES'
  | 'TEST_RESULT'
  | 'BUILD_RESULT'
  | 'USER_CONFIRMATION'
  | 'AGENT_SUMMARY';

export type EvidenceStatus = 'REPORTED' | 'VERIFIED' | 'REJECTED';

export interface ExecutionSessionArtifact {
  id: string;
  workspaceId: string;
  projectId?: string | null;
  workflowRunId?: string | null;
  executionSessionId?: string | null;
  artifactType: string;
  name: string;
  version: string;
  storageProvider: string;
  storageKey?: string | null;
  externalUrl?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  sha256?: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionSessionEvidence {
  id: string;
  executionSessionId: string;
  artifactId?: string | null;
  evidenceType: EvidenceType;
  sourceTool: SourceTool;
  title: string;
  summary?: string | null;
  status: EvidenceStatus;
  occurredAt: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  artifact?: ExecutionSessionArtifact | null;
}

export interface ExecutionSessionSyncEvent {
  id: string;
  eventId: string;
  executionSessionId: string;
  schemaVersion: string;
  sequence?: number | null;
  eventType: string;
  sourceTool: SourceTool;
  actorId?: string | null;
  deviceId?: string | null;
  traceId: string;
  occurredAt: string;
  receivedAt: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface ExecutionSessionEventsPage {
  items: ExecutionSessionSyncEvent[];
  nextCursor: string | null;
}

export interface IdeationSession {
  id: string;
  stage: 'BRAINSTORM' | 'DESIGN' | 'DEMO';
  attempt: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'WAITING_CONFIRMATION';
  statusMessage?: string | null;
  input: unknown;
  output: unknown;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

export interface IdeationSessionEvent {
  id: string;
  sessionId: string;
  eventType: 'STARTED' | 'STAGE' | 'HEARTBEAT' | 'STDERR' | 'STDOUT' | 'RETRY' | 'FAILED' | 'COMPLETED';
  stage: 'QUEUE' | 'CONTEXT_SCAN' | 'MODEL_RUNNING' | 'JSON_PARSE' | 'WRITE_FILES' | 'PREVIEW_START' | 'FINALIZE';
  message: string;
  details?: Record<string, unknown> | null;
  createdAt: string;
}

export interface DemoPage {
  route: string;
  componentName: string;
  componentCode: string;
  mockData: Record<string, unknown>;
  filePath: string;
  previewUrl?: string;
}

export interface DemoFlow {
  name: string;
  goal: string;
  entry: string;
  states: string[];
}

export interface DemoArtifact {
  summary: string;
  flows: DemoFlow[];
  scope: {
    included: string[];
    excluded: string[];
  };
  knownGaps: string[];
}

export interface IdeationArtifact {
  id: string;
  type: 'BRAINSTORM_BRIEF' | 'DESIGN_SPEC' | 'DEMO_PAGE';
  content: unknown;
  version: number;
  createdAt: string;
}
