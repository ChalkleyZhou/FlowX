import { describe, expect, it, vi } from 'vitest';
import { ContextPackageService } from './context-package.service';
import { EdgeHandoffService } from './edge-handoff.service';

function createService() {
  const prisma = {
    bug: { findUniqueOrThrow: vi.fn() },
    workflowRun: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const workflow = {
    createLocalChatWorkflowRun: vi.fn(),
    createLocalChatBugWorkflowRun: vi.fn(),
    claimLocalExecution: vi.fn(),
    getLocalHandoff: vi.fn(),
    findOne: vi.fn(),
  };
  const context = new ContextPackageService({} as never);
  return {
    service: new EdgeHandoffService(prisma as never, workflow as never, context),
    prisma,
    workflow,
  };
}

const handoff = {
  workflowRunId: 'workflow-1',
  status: 'EXECUTION_RUNNING',
  executor: 'LOCAL' as const,
  executionSessionId: 'session-1',
  traceId: 'trace-1',
  protocolVersion: '1.0',
  requirement: {
    id: 'req-1',
    title: 'Export CSV',
    description: 'Users need exports',
    acceptanceCriteria: 'CSV has headers',
  },
  plan: {
    summary: 'Plan',
    implementationPlan: [],
    filesToModify: [],
    newFiles: [],
    riskPoints: [],
  },
  tasks: [],
  repositories: [
    {
      workflowRepositoryId: 'wr-1',
      repositoryId: 'repo-1',
      name: 'flowx-web',
      url: 'https://example.com/flowx-web.git',
      baseBranch: 'main',
      workingBranch: 'flowx/work/export',
      checkout: { fetch: '', checkout: '', push: '' },
      suggestedCommitMessage: 'feat: export',
    },
  ],
  artifacts: { planMetaPath: null, planHtmlPath: null },
};

describe('EdgeHandoffService', () => {
  it('creates and claims a shared handoff for Codex', async () => {
    const { service, workflow } = createService();
    workflow.createLocalChatWorkflowRun.mockResolvedValue({
      id: 'workflow-1',
      status: 'EXECUTION_PENDING',
    });
    workflow.claimLocalExecution.mockResolvedValue({
      workflow: { id: 'workflow-1', status: 'EXECUTION_RUNNING' },
      handoff,
    });

    const result = await service.startHandoff({
      taskType: 'requirement',
      taskId: 'req-1',
      repositoryIds: ['repo-1'],
      sourceTool: 'codex',
    });

    expect(workflow.claimLocalExecution).toHaveBeenCalledWith(
      'workflow-1',
      undefined,
      'codex',
    );
    expect(result.contextPackage.executionSessionId).toBe('session-1');
    expect(result.contextPackage.sourceTool).toBe('codex');
    expect(result.chatPrompt).toContain('Work in Codex');
  });

  it('continues an existing running workflow without creating a duplicate', async () => {
    const { service, prisma, workflow } = createService();
    prisma.workflowRun.findMany.mockResolvedValue([
      {
        id: 'workflow-1',
        status: 'EXECUTION_RUNNING',
        workflowRepositories: [{ repositoryId: 'repo-1' }],
      },
    ]);
    workflow.getLocalHandoff.mockResolvedValue(handoff);

    const result = await service.startHandoff({
      taskType: 'requirement',
      taskId: 'req-1',
      repositoryIds: ['repo-1'],
      sourceTool: 'cursor',
    });

    expect(workflow.createLocalChatWorkflowRun).not.toHaveBeenCalled();
    expect(workflow.getLocalHandoff).toHaveBeenCalledWith('workflow-1');
    expect(result.chatPrompt).toContain('Cursor Chat/Agent');
  });
});
