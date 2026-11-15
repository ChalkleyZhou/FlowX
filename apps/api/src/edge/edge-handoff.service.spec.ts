import { describe, expect, it, vi } from 'vitest';
import { ContextPackageService } from './context-package.service';
import { EdgeHandoffService } from './edge-handoff.service';

function createService() {
  const prisma = {
    executionItem: { findUnique: vi.fn() },
  };
  const workflow = {

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
  workItem: {
    id: 'work-1',
    kind: 'REQUIREMENT',
    title: 'Export CSV',
    description: 'Users need exports',
    acceptanceCriteria: 'CSV has headers',
  },
  executionItem: { id: 'exec-1', title: 'Export CSV', description: 'Users need exports' },
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
    const { service, workflow, prisma } = createService();
    prisma.executionItem.findUnique.mockResolvedValue({ executionPlan: { workflowRun: { id: 'workflow-1', status: 'EXECUTION_PENDING' } } });
    workflow.claimLocalExecution.mockResolvedValue({
      workflow: { id: 'workflow-1', status: 'EXECUTION_RUNNING' },
      handoff,
    });

    const result = await service.startHandoff({
      executionItemId: 'exec-1', claimKey: 'claim-1', sourceTool: 'codex',
    });

    expect(workflow.claimLocalExecution).toHaveBeenCalledWith(
      'workflow-1',
      undefined,
      'codex',
      'claim-1',
      'exec-1',
    );
    expect(result.contextPackage.executionSessionId).toBe('session-1');
    expect(result.contextPackage.sourceTool).toBe('codex');
    expect(result.chatPrompt).toContain('Work in Codex');
  });

  it('continues an existing running workflow without creating a duplicate', async () => {
    const { service, prisma, workflow } = createService();
    prisma.executionItem.findUnique.mockResolvedValue({ executionPlan: { workflowRun: { id: 'workflow-1', status: 'EXECUTION_RUNNING' } } });
    workflow.getLocalHandoff.mockResolvedValue(handoff);

    const result = await service.startHandoff({
      executionItemId: 'exec-1', claimKey: 'claim-1', sourceTool: 'cursor',
    });

    expect(workflow.getLocalHandoff).toHaveBeenCalledWith('workflow-1');
    expect(result.chatPrompt).toContain('Cursor Chat/Agent');
  });
});
