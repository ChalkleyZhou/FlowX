import type { RequirementProfileFields } from '@flowx-ai/protocol';
import type { SpecPlanOutput } from '../common/types';

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
  status: string;
  executor: 'LOCAL';
  executionSessionId: string;
  traceId: string;
  protocolVersion: string;
  workItem: {
    id: string;
    kind: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
  } & RequirementProfileFields;
  executionItem: {
    id: string;
    title: string;
    description: string;
  };
  specPlan: SpecPlanOutput;
  repositories: LocalHandoffRepository[];
  artifacts: {
    planMetaPath: string | null;
    planHtmlPath: string | null;
  };
}

export interface BuildLocalHandoffInput {
  workflowRunId: string;
  status: string;
  workItem: LocalHandoffPayload['workItem'];
  executionItem: LocalHandoffPayload['executionItem'];
  specPlan: SpecPlanOutput;
  workflowRepositories: Array<{
    id: string;
    repositoryId: string | null;
    name: string;
    url: string;
    baseBranch: string;
    workingBranch: string;
  }>;
  planMetaPath?: string | null;
  planHtmlPath?: string | null;
  executionSession: {
    id: string;
    traceId: string;
    protocolVersion: string;
  };
}

export function buildSuggestedCommitMessage(workflowRunId: string, requirementTitle: string) {
  const normalizedTitle = requirementTitle
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[:\r\n]+/g, ' ')
    .slice(0, 60);
  const shortId = workflowRunId.slice(-8);
  return `feat(flowx): [wf ${shortId}] ${normalizedTitle || 'workflow update'}`;
}

export function buildRepositoryCheckoutHints(baseBranch: string, workingBranch: string): LocalHandoffCheckoutHints {
  const base = baseBranch.trim() || 'main';
  const branch = workingBranch.trim();
  return {
    fetch: 'git fetch origin',
    checkout: `git checkout -B ${branch} origin/${base}`,
    push: `git push -u origin ${branch}`,
  };
}

export function buildLocalHandoff(input: BuildLocalHandoffInput): LocalHandoffPayload {
  const suggestedCommitMessage = buildSuggestedCommitMessage(input.workflowRunId, input.workItem.title);

  return {
    workflowRunId: input.workflowRunId,
    status: input.status,
    executor: 'LOCAL',
    executionSessionId: input.executionSession.id,
    traceId: input.executionSession.traceId,
    protocolVersion: input.executionSession.protocolVersion,
    workItem: input.workItem,
    executionItem: input.executionItem,
    specPlan: input.specPlan,
    repositories: input.workflowRepositories.map((repository) => ({
      workflowRepositoryId: repository.id,
      repositoryId: repository.repositoryId,
      name: repository.name,
      url: repository.url,
      baseBranch: repository.baseBranch,
      workingBranch: repository.workingBranch,
      checkout: buildRepositoryCheckoutHints(repository.baseBranch, repository.workingBranch),
      suggestedCommitMessage,
    })),
    artifacts: {
      planMetaPath: input.planMetaPath ?? null,
      planHtmlPath: input.planHtmlPath ?? null,
    },
  };
}
