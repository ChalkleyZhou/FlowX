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

    await expect(
      runLaunch(
        { ticket: 'ticket-1', ide: 'cursor', apiBaseUrl: 'https://flowx.example/' },
        {
          fetch,
          resolveRepoPath: vi.fn(async () => '/work/repo'),
          ensureProject,
          writePromptFile,
          openIde,
          resolveMcpEntryPath: () => '/tools/flowx-mcp/dist/index.js',
        },
      ),
    ).resolves.toEqual({
      ok: true,
      gitRoot: '/work/repo',
      ide: 'cursor',
      prefilled: false,
      promptPath: '/work/repo/.flowx/tasks/workflow-1.md',
    });

    expect(fetch).toHaveBeenCalledWith('https://flowx.example/local-launch/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket: 'ticket-1' }),
    });
    expect(ensureProject).toHaveBeenCalledWith('/work/repo', {
      apiBaseUrl: 'https://flowx.example',
      mcpToken: 'token-1',
      mcpEntryPath: '/tools/flowx-mcp/dist/index.js',
    });
    expect(openIde).toHaveBeenCalledWith('cursor', '/work/repo', 'Implement this task.');
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
});
