import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { LocalLaunchTicketStore } from './local-launch-ticket.store';
import { LocalLaunchService } from './local-launch.service';
import { WorkflowService } from './workflow.service';

const session = {
  user: { id: 'user-1', displayName: 'Ada' },
  organization: { id: 'org-1', name: 'FlowX Org' },
};

const handoff = {
  workflowRunId: 'run-1',
  status: 'EXECUTION_RUNNING',
  executor: 'LOCAL' as const,
  requirement: {
    id: 'req-1',
    title: 'Export CSV',
    description: 'Add CSV export for reports',
    acceptanceCriteria: 'User can download a CSV',
  },
  plan: {
    summary: 'plan',
    architectureOverview: 'arch',
    implementationSteps: [],
    risks: [],
    testStrategy: 'tests',
  },
  tasks: [],
  repositories: [
    {
      workflowRepositoryId: 'wr-1',
      repositoryId: 'repo-1',
      name: 'flowx-web',
      url: 'https://github.com/acme/flowx-web.git',
      baseBranch: 'main',
      workingBranch: 'flowx/work/local/run-1',
      checkout: {
        fetch: 'git fetch',
        checkout: 'git checkout',
        push: 'git push',
      },
      suggestedCommitMessage: 'feat: export csv',
    },
  ],
  artifacts: {
    planMetaPath: null,
    planHtmlPath: null,
  },
};

function createService() {
  const workflowService = {
    getLocalHandoff: vi.fn().mockResolvedValue(handoff),
  };
  const authService = {
    createShortLivedSession: vi.fn().mockResolvedValue({
      token: 'mcp-1',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    }),
  };
  const ticketStore = new LocalLaunchTicketStore();
  const service = new LocalLaunchService(
    workflowService as unknown as WorkflowService,
    authService as unknown as AuthService,
    ticketStore,
  );

  return { service, workflowService, authService, ticketStore };
}

describe('LocalLaunchService', () => {
  it('issues a ticket and redeems once with handoff + mcpToken + chatPrompt', async () => {
    const { service, workflowService, authService } = createService();

    const issued = await service.issueTicket('run-1', session);
    expect(issued.ticket).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.loopbackPort).toBe(3920);
    expect(workflowService.getLocalHandoff).toHaveBeenCalledWith('run-1');

    const redeemed = await service.redeemTicket(issued.ticket);
    expect(redeemed.workflowRunId).toBe('run-1');
    expect(redeemed.mcpToken).toBe('mcp-1');
    expect(redeemed.handoff).toEqual(handoff);
    expect(redeemed.chatPrompt).toContain('run-1');
    expect(redeemed.apiBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(authService.createShortLivedSession).toHaveBeenCalledWith('user-1', 'org-1');

    await expect(service.redeemTicket(issued.ticket)).rejects.toThrow(/invalid|expired/i);
  });

  it('rejects expired tickets', async () => {
    const { service } = createService();

    const issued = await service.issueTicket('run-1', session, { ttlMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(service.redeemTicket(issued.ticket)).rejects.toThrow(/invalid|expired/i);
  });
});
