import type { SourceTool } from './execution-session.js';

export const EDGE_TASK_TYPES = ['requirement', 'bug'] as const;

export type EdgeTaskType = (typeof EDGE_TASK_TYPES)[number];

/** 需求资料中可增量带给本地交接的字段。缺省表示未填写，旧客户端可忽略。 */
export interface RequirementProfileFields {
  priority?: string;
  functionalModule?: string;
  riskImpact?: string;
  productRequirementDocument?: string;
  remark?: string;
  createdByName?: string;
}

export interface ContextRepository {
  repositoryId: string;
  workflowRepositoryId?: string;
  name: string;
  url: string | null;
  baseBranch?: string;
  workingBranch?: string;
}

export interface ContextPackage {
  protocolVersion: string;
  generatedAt: string;
  sourceTool: SourceTool;
  task: {
    type: EdgeTaskType;
    id: string;
    title: string;
    description?: string | null;
    acceptanceCriteria?: string | null;
    expectedBehavior?: string | null;
    actualBehavior?: string | null;
    reproductionSteps?: string[];
  } & RequirementProfileFields;
  workflowRunId?: string | null;
  executionSessionId?: string | null;
  repositories: ContextRepository[];
  suggestedChecks?: string[];
  metadata?: Record<string, unknown>;
}
