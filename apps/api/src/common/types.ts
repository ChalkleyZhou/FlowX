import { HumanReviewDecision, StageType } from './enums';

export interface RequirementRecord {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
}

export interface RepositoryContext {
  id: string;
  name: string;
  url: string;
  defaultBranch?: string | null;
  currentBranch?: string | null;
  localPath?: string | null;
  syncStatus?: string | null;
  contextSnapshot?: {
    strategy?: string;
    summary?: string;
    evidenceFiles?: string[];
  } | null;
}

export interface WorkspaceContext {
  id: string;
  name: string;
  description?: string | null;
  repositories: RepositoryContext[];
}

export interface WorkflowRepositoryContext extends RepositoryContext {
  baseBranch?: string | null;
  workingBranch?: string | null;
}

export interface SplitTasksInput {
  requirement: RequirementRecord;
  workspace?: WorkspaceContext | null;
  humanFeedback?: string | null;
  previousOutput?: SplitTasksOutput | null;
  demoPageContext?: unknown | null;
}

export interface SplitTaskItem {
  title: string;
  description: string;
  surface: string;
  repositoryNames: string[];
}

export interface SplitTasksOutput {
  tasks: SplitTaskItem[];
  ambiguities: string[];
  risks: string[];
}

export interface GeneratePlanInput {
  requirement: RequirementRecord;
  tasks: SplitTaskItem[];
  workspace?: WorkspaceContext | null;
  humanFeedback?: string | null;
  previousOutput?: GeneratePlanOutput | null;
  demoPageContext?: unknown | null;
}

export interface GeneratePlanOutput {
  summary: string;
  implementationPlan: string[];
  filesToModify: string[];
  newFiles: string[];
  riskPoints: string[];
}

export interface ExecuteTaskInput {
  requirement: RequirementRecord;
  tasks: SplitTaskItem[];
  plan: GeneratePlanOutput;
  workspace?: WorkspaceContext | null;
  humanFeedback?: string | null;
}

export interface ExecuteTaskOutput {
  patchSummary: string;
  changedFiles: string[];
  codeChanges: Array<{
    file: string;
    changeType: 'create' | 'update';
    summary: string;
  }>;
  diffArtifacts: Array<{
    repository: string;
    branch: string;
    localPath: string;
    diffStat: string;
    diffText: string;
    untrackedFiles: string[];
  }>;
}

export interface ReviewCodeInput {
  requirement: RequirementRecord;
  plan: GeneratePlanOutput;
  execution: ExecuteTaskOutput;
  workspace?: WorkspaceContext | null;
  humanFeedback?: string | null;
  previousOutput?: ReviewCodeOutput | null;
}

export interface ReviewCodeOutput {
  issues: string[];
  bugs: string[];
  missingTests: string[];
  suggestions: string[];
  impactScope: string[];
}

export type DailyCodeReviewUnitStatus =
  | 'COMPLETED'
  | 'SKIPPED_NO_SKILL'
  | 'SKIPPED_NO_CHANGES'
  | 'SKIPPED_NO_REPO'
  | 'FAILED';

export interface DailyCodeReviewUnitOutput extends ReviewCodeOutput {
  status: DailyCodeReviewUnitStatus;
  skillHint?: string;
  errorMessage?: string;
}

export interface DailyCodeReviewCommitRef {
  id: string;
  message: string;
  author?: string;
}

export interface DailyCodeReviewUnitInput {
  repositoryName: string;
  repositoryId: string | null;
  localPath: string | null;
  ref: string;
  commits: DailyCodeReviewCommitRef[];
  date: string;
  rangeLabel: string;
  /** Server-collected git diffs so the agent does not need shell access. */
  commitDiffBundle?: string;
}

export interface ReviewDailyChangesInput {
  unit: DailyCodeReviewUnitInput;
  workspace?: WorkspaceContext | null;
}

export interface PromptTemplate {
  name: string;
  version: string;
  system: string;
  user: string;
}

export interface StageHistoryRecord {
  stage: StageType;
  status: string;
  input: unknown;
  output: unknown;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface HumanReviewDecisionInput {
  decision: HumanReviewDecision;
}

// Ideation types

export interface BrainstormInput {
  requirementTitle: string;
  requirementDescription: string;
  previousBriefs?: BrainstormBrief[];
  humanFeedback?: string;
  workspaceContext?: string;
}

export interface BrainstormBrief {
  expandedDescription: string;
  userStories: Array<{
    role: string;
    action: string;
    benefit: string;
  }>;
  edgeCases: string[];
  successMetrics: string[];
  openQuestions: string[];
  assumptions: string[];
  outOfScope: string[];
}

export interface BrainstormOutput {
  brief: BrainstormBrief;
}

export interface GenerateDesignInput {
  requirementTitle: string;
  requirementDescription: string;
  confirmedBrief: BrainstormBrief;
  previousDesigns?: DesignSpec[];
  humanFeedback?: string;
  repositoryComponentContext?: RepositoryComponentContext;
}

/**
 * 'design' = OpenDesign-grounded high-fidelity HTML artifact phase (DesignSpec + 单页 HTML，无需 demoPages)。
 * 'demo' (默认) = 现有可运行 demoPages 落地阶段（保持原有严格契约）。
 */
export type GenerateDesignPhase = 'design' | 'demo';

export interface GenerateDesignOptions {
  phase?: GenerateDesignPhase;
}

export interface DesignSpec {
  overview: string;
  pages: Array<{
    name: string;
    route: string;
    layout: string;
    keyComponents: string[];
    interactions: string[];
  }>;
  demoScenario: string;
  designRationale: string;
}

export interface DemoPage {
  route: string;
  componentName: string;
  componentCode: string;
  mockData: Record<string, unknown>;
  filePath: string;
  /** 主导航/侧栏展示名；FlowX 会尝试写入 navMain/menuItems 等数据数组（最佳努力）。 */
  navLabel?: string;
}

export interface DemoFlow {
  name: string;
  goal: string;
  entry: string;
  states: string[];
}

export interface DemoScope {
  included: string[];
  excluded: string[];
}

export interface DemoArtifact {
  summary: string;
  flows: DemoFlow[];
  scope: DemoScope;
  knownGaps: string[];
}

export interface RepositoryComponentContext {
  componentFiles: string[];
  propTypes: Array<{ name: string; props: string }>;
  pageExamples: Array<{ path: string; code: string }>;
  designTokens?: string;
  /** Sampled route/router/auth snippets — align demo route registration; demo should bypass permission UI hiding for review */
  routingAndAccessHints?: string;
}

/**
 * OpenDesign 产出的高保真单页 HTML 设计稿引用。
 * 设计阶段 agent 通过 OpenDesign MCP 读取设计系统/技能后，内联返回 `html`；
 * FlowX 落盘到 `.flowx-data/design-artifacts/<runId>/...` 并以 `relPath` 记录位置。
 */
export interface DesignArtifactRef {
  /** 内联单页 HTML（agent / mock 返回；落盘后持久化输出中可不再保留以减小体积）。 */
  html?: string;
  /** 相对 design-artifacts 根目录的持久化路径（落盘后写入）。 */
  relPath?: string;
  generatedAt?: string;
  bytes?: number;
}

export interface GenerateDesignOutput {
  design: DesignSpec;
  demo: DemoArtifact;
  demoPages: DemoPage[];
  designArtifact?: DesignArtifactRef;
}

/** 设计阶段（OpenDesign HTML artifact）的 executor 输出形态：必含 designArtifact，demoPages 可选。 */
export interface DesignPhaseOutput {
  design: DesignSpec;
  demo: DemoArtifact;
  designArtifact: DesignArtifactRef;
  demoPages?: DemoPage[];
}
