import { describe, expect, it, vi } from 'vitest';
import { OpenDesignEdgeService } from './open-design-edge.service';

const session = {
  user: { id: 'user-1', displayName: 'Designer' },
  organization: { id: 'org-1', name: 'FlowX' },
};

const handoff = {
  protocolVersion: '1.0',
  workflowRunId: 'workflow-1',
  executionSessionId: 'session-1',
  traceId: 'trace-1',
  contextPackage: {
    protocolVersion: '1.0',
    generatedAt: '2026-07-22T00:00:00.000Z',
    sourceTool: 'opendesign' as const,
    workflowRunId: 'workflow-1',
    executionSessionId: 'session-1',
    traceId: 'trace-1',
    requirement: {
      id: 'req-1',
      title: 'Export design',
      description: 'Design export flow',
      acceptanceCriteria: 'Covers empty states',
    },
    repositories: [],
    outputContract: {
      resultFileName: 'result.json',
      format: 'flowx-design-result-v1' as const,
      requiredFields: ['design', 'demo', 'designArtifact'] as const,
    },
  },
  completionEndpoint: '/execution-sessions/session-1/design/complete',
};

function createService() {
  const prisma = {
    workflowRun: { findFirst: vi.fn() },
  };
  const workflow = {
    createLocalDesignWorkflowRun: vi.fn(),
    claimLocalDesign: vi.fn(),
    claimLocalBrainstorm: vi.fn(),
    getLocalDesignHandoff: vi.fn().mockResolvedValue(handoff),
    getLocalBrainstormHandoff: vi.fn(),
    findOne: vi.fn(),
    completeLocalDesignSession: vi.fn(),
    completeLocalBrainstormSession: vi.fn(),
  };
  const auth = {
    createShortLivedSession: vi.fn().mockResolvedValue({
      token: 'short-token',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    }),
  };
  return {
    service: new OpenDesignEdgeService(prisma as never, workflow as never, auth as never),
    prisma,
    workflow,
    auth,
  };
}

describe('OpenDesignEdgeService', () => {
  it('creates, claims and issues a one-time local launch ticket', async () => {
    const { service, prisma, workflow } = createService();
    prisma.workflowRun.findFirst.mockResolvedValue(null);
    workflow.createLocalDesignWorkflowRun.mockResolvedValue({
      id: 'workflow-1',
      status: 'DESIGN_PENDING',
    });
    workflow.claimLocalDesign.mockResolvedValue({
      workflow: { id: 'workflow-1', status: 'DESIGN_PENDING' },
      handoff,
    });

    const result = await service.startHandoff({ requirementId: 'req-1' }, session);

    expect(result.ticket).toMatch(/^[a-f0-9]{64}$/);
    expect(result.loopbackPort).toBe(3920);
    expect(workflow.createLocalDesignWorkflowRun).toHaveBeenCalledWith({
      requirementId: 'req-1',
      repositoryIds: undefined,
    });

    const redeemed = await service.redeem(result.ticket);
    expect(redeemed.handoff).toEqual(handoff);
    expect(redeemed.stage).toBe('design');
    expect(redeemed.accessToken).toBe('short-token');
    await expect(service.redeem(result.ticket)).rejects.toThrow(/invalid|expired/i);
  });

  it('claims brainstorm and redeems a brainstorm ticket', async () => {
    const { service, workflow } = createService();
    const brainstormHandoff = {
      ...handoff,
      contextPackage: {
        ...handoff.contextPackage,
        stage: 'BRAINSTORM' as const,
        outputContract: {
          resultFileName: 'spec.md' as const,
          format: 'flowx-brainstorm-markdown-v1' as const,
        },
      },
      completionEndpoint: '/execution-sessions/session-1/brainstorm/complete',
    };
    workflow.findOne.mockResolvedValue({ id: 'workflow-1', status: 'BRAINSTORM_PENDING' });
    workflow.claimLocalBrainstorm.mockResolvedValue({
      workflow: { id: 'workflow-1', status: 'BRAINSTORM_PENDING' },
      handoff: brainstormHandoff,
    });
    workflow.getLocalBrainstormHandoff.mockResolvedValue(brainstormHandoff);

    const result = await service.retryBrainstormHandoff('workflow-1', session);
    const redeemed = await service.redeem(result.ticket);

    expect(redeemed.stage).toBe('brainstorm');
    expect(redeemed.kind).toBe('opendesign-brainstorm');
    expect(redeemed.handoff).toEqual(brainstormHandoff);
  });

  it('re-claims design on retry instead of requiring an already-active session', async () => {
    const { service, workflow } = createService();
    workflow.findOne.mockResolvedValue({ id: 'workflow-1', status: 'DESIGN_PENDING' });
    workflow.claimLocalDesign.mockResolvedValue({
      workflow: { id: 'workflow-1', status: 'DESIGN_PENDING' },
      handoff,
    });

    const result = await service.retryHandoff('workflow-1', session);

    expect(workflow.claimLocalDesign).toHaveBeenCalledWith('workflow-1', session);
    expect(workflow.getLocalDesignHandoff).not.toHaveBeenCalled();
    expect(result.ticket).toMatch(/^[a-f0-9]{64}$/);
    expect(result.handoff).toEqual(handoff);
  });

  it('delegates design completion to the workflow lifecycle', async () => {
    const { service, workflow } = createService();
    const report = {
      idempotencyKey: 'design:session-1:v1',
      output: {
        design: { overview: 'Design' },
        demo: { summary: 'Flow' },
        designArtifact: { html: '<!doctype html><html></html>' },
      },
    };

    await service.complete('session-1', report, { organizationId: 'org-1' });

    expect(workflow.completeLocalDesignSession).toHaveBeenCalledWith(
      'session-1',
      report,
      { organizationId: 'org-1' },
    );
  });

  it('passes auth session into local handoff getters for lazy claim', async () => {
    const { service, workflow } = createService();

    await service.getHandoff('workflow-1', session);
    await service.getBrainstormHandoff('workflow-1', session);

    expect(workflow.getLocalDesignHandoff).toHaveBeenCalledWith('workflow-1', session);
    expect(workflow.getLocalBrainstormHandoff).toHaveBeenCalledWith('workflow-1', session);
  });
});
