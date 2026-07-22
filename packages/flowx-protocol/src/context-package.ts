import type { SourceTool } from './execution-session.js';

export const EDGE_TASK_TYPES = ['requirement', 'bug'] as const;

export type EdgeTaskType = (typeof EDGE_TASK_TYPES)[number];

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
  };
  workflowRunId?: string | null;
  executionSessionId?: string | null;
  repositories: ContextRepository[];
  suggestedChecks?: string[];
  metadata?: Record<string, unknown>;
}
