import { describe, expect, it } from 'vitest';
import { buildLocalChatPrompt } from './local-chat-prompt';
import { buildLocalChatRequirementBootstrap } from './local-chat-workflow.bootstrap';

describe('local chat workflow helpers', () => {
  it('builds a requirement prompt with acceptance criteria and completion instructions', () => {
    const prompt = buildLocalChatPrompt({
      taskType: 'requirement',
      taskId: 'req-1',
      workflowRunId: 'wr-1',
      executionSessionId: 'session-1',
      workflowRepositoryId: 'workflow-repository-1',
      title: 'Add export',
      description: 'Users need CSV export',
      acceptanceCriteria: 'CSV downloads with headers',
      repository: {
        name: 'flowx-web',
        url: 'https://github.com/org/flowx-web.git',
        workingBranch: 'flowx/work/export/abc12345',
      },
      suggestedChecks: ['pnpm --filter flowx-web test'],
    });

    expect(prompt).toContain('req-1');
    expect(prompt).toContain('Acceptance criteria');
    expect(prompt).toContain('CSV downloads with headers');
    expect(prompt).toContain('session-1');
    expect(prompt).toContain('workflow-repository-1');
    expect(prompt).toContain('flowx_report_completion');
  });

  it('builds a bug prompt with reproduction, expected behavior, and regression guidance', () => {
    const prompt = buildLocalChatPrompt({
      taskType: 'bug',
      taskId: 'bug-1',
      workflowRunId: 'wr-2',
      title: 'Login fails',
      description: 'Login button returns 500',
      expectedBehavior: 'User reaches dashboard',
      actualBehavior: 'The page shows a 500 toast',
      reproductionSteps: ['Open login page', 'Submit valid credentials'],
      repository: {
        name: 'flowx-api',
        url: 'git@github.com:org/flowx-api.git',
        workingBranch: 'flowx/work/login-fix/abc12345',
      },
      suggestedChecks: ['pnpm --filter flowx-api test'],
    });

    expect(prompt).toContain('Reproduction');
    expect(prompt).toContain('Expected behavior');
    expect(prompt).toContain('Regression');
    expect(prompt).toContain('Submit valid credentials');
  });

  it('builds a Codex-specific launch instruction from the shared context', () => {
    const prompt = buildLocalChatPrompt({
      sourceTool: 'codex',
      taskType: 'requirement',
      taskId: 'req-codex',
      workflowRunId: 'wr-codex',
      title: 'Add edge handoff',
      description: 'Use the shared context package',
      repository: { name: 'flowx', url: null, workingBranch: 'flowx/work/edge' },
    });

    expect(prompt).toContain('Work in Codex');
    expect(prompt).not.toContain('Work in Cursor Chat/Agent');
  });

  it('builds a minimal requirement bootstrap for local chat execution', () => {
    const bootstrap = buildLocalChatRequirementBootstrap({
      title: ' Add export ',
      description: ' Users need CSV export ',
      acceptanceCriteria: ' CSV downloads with headers ',
    });

    expect(bootstrap.task).toEqual({
      title: 'Add export',
      description: 'Users need CSV export',
      surface: 'local_chat',
      repositoryNames: [],
    });
    expect(bootstrap.plan.summary).toBe('本地 Chat 实现：Add export');
    expect(bootstrap.plan.implementationPlan).toContain('验收：CSV downloads with headers');
  });
});
