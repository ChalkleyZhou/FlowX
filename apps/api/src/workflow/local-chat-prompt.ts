export type LocalChatTaskType = 'requirement' | 'bug';

export interface LocalChatPromptRepository {
  name: string;
  url?: string | null;
  workingBranch: string;
}

export interface BuildLocalChatPromptInput {
  sourceTool?: 'cursor' | 'codex';
  taskType: LocalChatTaskType;
  taskId: string;
  workflowRunId: string;
  executionSessionId?: string | null;
  workflowRepositoryId?: string | null;
  title: string;
  description: string;
  acceptanceCriteria?: string | null;
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
  reproductionSteps?: string[] | null;
  repository: LocalChatPromptRepository;
  suggestedChecks?: string[];
}

function formatOptionalLine(label: string, value?: string | null) {
  const text = value?.trim();
  return text ? [`## ${label}`, text] : [];
}

function formatSuggestedChecks(checks?: string[]) {
  const normalized = (checks ?? []).map((check) => check.trim()).filter(Boolean);
  if (normalized.length === 0) {
    return ['## Suggested checks', '- Run the smallest relevant tests before reporting completion.'];
  }
  return ['## Suggested checks', ...normalized.map((check) => `- \`${check}\``)];
}

function formatReproduction(steps?: string[] | null) {
  const normalized = (steps ?? []).map((step) => step.trim()).filter(Boolean);
  if (normalized.length === 0) {
    return [];
  }
  return ['## Reproduction', ...normalized.map((step, index) => `${index + 1}. ${step}`)];
}

export function buildLocalChatPrompt(input: BuildLocalChatPromptInput) {
  const taskLabel = input.taskType === 'bug' ? 'Bug' : 'Requirement';
  const toolInstruction =
    input.sourceTool === 'codex'
      ? '- Work in Codex and keep the implementation, tests, and completion report in the same task.'
      : '- Work in Cursor Chat/Agent and iterate there until the change is ready.';
  const lines = [
    `# FlowX ${taskLabel}: ${input.title.trim()}`,
    '',
    '## FlowX context',
    `- Task type: ${input.taskType}`,
    `- Task id: ${input.taskId}`,
    `- Workflow run id: ${input.workflowRunId}`,
    input.executionSessionId?.trim() ? `- Execution session id: ${input.executionSessionId.trim()}` : '',
    input.workflowRepositoryId?.trim()
      ? `- Workflow repository id: ${input.workflowRepositoryId.trim()}`
      : '',
    `- Repository: ${input.repository.name}`,
    input.repository.url?.trim() ? `- Remote: ${input.repository.url.trim()}` : '',
    `- Working branch: ${input.repository.workingBranch}`,
    toolInstruction,
    '',
    '## Description',
    input.description.trim(),
    '',
    ...formatOptionalLine('Acceptance criteria', input.acceptanceCriteria),
    ...formatOptionalLine('Actual behavior', input.actualBehavior),
    ...formatOptionalLine('Expected behavior', input.expectedBehavior),
    ...formatReproduction(input.reproductionSteps),
    ...(input.taskType === 'bug'
      ? ['## Regression', 'Verify the fix against the reproduction path and nearby behavior.']
      : []),
    ...formatSuggestedChecks(input.suggestedChecks),
    '',
    '## Completion',
    'When the implementation is ready, call MCP `flowx_report_completion` with `workflowRunId`, `executionSessionId`, and `workflowRepositoryId`, plus `implementationSummary`, `testResult`, and `pushed`.',
  ];

  return lines.filter((line) => line !== '').join('\n');
}
