import { describe, expect, it, vi } from 'vitest';
import { runLaunch } from './launch.js';

describe('runLaunch', () => {
  it('redeems with the supplied API base then prepares and opens the first repository', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        apiBaseUrl: 'https://flowx.example',
        workflowRunId: 'workflow-1',
        handoff: {
          executionSessionId: 'session-1',
          repositories: [
            { url: '', workingBranch: 'ignored' },
            { url: 'https://github.com/org/repo.git', workingBranch: 'feat/flowx' },
          ],
        },
        chatPrompt: 'Implement this task.',
        mcpToken: 'token-1',
      }),
    }));
    const ensureProject = vi.fn();
    const writePromptFile = vi.fn(() => '/work/repo/.flowx/tasks/workflow-1.md');
    const openIde = vi.fn(async () => ({ opened: true, prefilled: false }));
    const adapterLaunch = vi.fn(async () => ({
      ok: true as const,
      gitRoot: '/work/repo',
      ide: 'cursor' as const,
      prefilled: false,
      promptPath: '/work/repo/.flowx/tasks/workflow-1.md',
      executionSessionId: 'session-1',
      workflowRunId: 'workflow-1',
    }));
    const registry = {
      resolve: vi.fn(() => ({ launch: adapterLaunch })),
    };

    await expect(
      runLaunch(
        { ticket: 'ticket-1', ide: 'cursor', apiBaseUrl: 'https://flowx.example/' },
        {
          fetch,
          resolveRepoPath: vi.fn(async () => '/work/repo'),
          ensureProject,
          writePromptFile,
          openIde,
          registry,
          resolveMcpEntryPath: () => '/tools/flowx-mcp/dist/index.js',
        },
      ),
    ).resolves.toEqual({
      ok: true,
      gitRoot: '/work/repo',
      ide: 'cursor',
      prefilled: false,
      promptPath: '/work/repo/.flowx/tasks/workflow-1.md',
      executionSessionId: 'session-1',
      workflowRunId: 'workflow-1',
    });

    expect(fetch).toHaveBeenCalledWith('https://flowx.example/local-launch/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: 'ticket-1' }),
    });
    expect(adapterLaunch).toHaveBeenCalledWith({
      gitRoot: '/work/repo',
      workflowRunId: 'workflow-1',
      executionSessionId: 'session-1',
      chatPrompt: 'Implement this task.',
      apiBaseUrl: 'https://flowx.example',
      mcpToken: 'token-1',
      mcpEntryPath: '/tools/flowx-mcp/dist/index.js',
    });
    expect(adapterLaunch.mock.calls[0]?.[0]).not.toHaveProperty('ide');
  });

  it('rejects unsuccessful ticket redemption as a redeem failure', async () => {
    await expect(
      runLaunch(
        { ticket: 'ticket-1', ide: 'cursor', apiBaseUrl: 'https://flowx.example' },
        {
          fetch: async () => ({ ok: false, status: 401, text: async () => 'expired' }),
          resolveRepoPath: vi.fn(),
          ensureProject: vi.fn(),
          writePromptFile: vi.fn(),
          openIde: vi.fn(),
          resolveMcpEntryPath: () => '/tools/flowx-mcp/dist/index.js',
        },
      ),
    ).rejects.toMatchObject({ code: 'REDEEM_FAILED' });
  });

  it('rejects an incomplete redemption before launching an adapter', async () => {
    const adapterLaunch = vi.fn();
    const registry = {
      resolve: vi.fn(() => ({ launch: adapterLaunch })),
    };

    await expect(
      runLaunch(
        { ticket: 'ticket-1', ide: 'cursor', apiBaseUrl: 'https://flowx.example' },
        {
          fetch: async () => ({
            ok: true,
            json: async () => ({
              apiBaseUrl: 'https://flowx.example',
              workflowRunId: 'workflow-1',
              handoff: {
                repositories: [{ url: 'https://github.com/org/repo.git' }],
              },
              chatPrompt: 'Implement this task.',
              mcpToken: 'token-1',
            }),
          }),
          resolveRepoPath: vi.fn(async () => '/work/repo'),
          registry,
          resolveMcpEntryPath: () => '/tools/flowx-mcp/dist/index.js',
        },
      ),
    ).rejects.toMatchObject({ code: 'REDEEM_FAILED' });

    expect(adapterLaunch).not.toHaveBeenCalled();
  });
});
