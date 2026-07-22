import type { GeneratePlanOutput } from '../common/types';

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

export interface LocalHandoffTask {
  id: string;
  title: string;
  description: string;
  surface: string | null;
  repositoryNames: string[];
}

export interface LocalHandoffPayload {
  workflowRunId: string;
  status: string;
  executor: 'LOCAL';
  executionSessionId?: string;
  traceId?: string;
  protocolVersion?: string;
  requirement: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
  };
  plan: GeneratePlanOutput;
  tasks: LocalHandoffTask[];
  repositories: LocalHandoffRepository[];
  artifacts: {
    planMetaPath: string | null;
    planHtmlPath: string | null;
  };
}

export interface BuildLocalHandoffInput {
  workflowRunId: string;
  status: string;
  requirement: LocalHandoffPayload['requirement'];
  plan: GeneratePlanOutput;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    surface?: string | null;
    repositoryNames?: unknown;
  }>;
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
  executionSession?: {
    id: string;
    traceId: string;
    protocolVersion: string;
  } | null;
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
  const suggestedCommitMessage = buildSuggestedCommitMessage(input.workflowRunId, input.requirement.title);

  return {
    workflowRunId: input.workflowRunId,
    status: input.status,
    executor: 'LOCAL',
    ...(input.executionSession
      ? {
          executionSessionId: input.executionSession.id,
          traceId: input.executionSession.traceId,
          protocolVersion: input.executionSession.protocolVersion,
        }
      : {}),
    requirement: input.requirement,
    plan: input.plan,
    tasks: input.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      surface: task.surface ?? null,
      repositoryNames: Array.isArray(task.repositoryNames) ? task.repositoryNames.map(String) : [],
    })),
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
