import { describe, expect, it, vi } from 'vitest';
import { CodexAdapter } from './codex-adapter.js';
import { CursorAdapter } from './cursor-adapter.js';

const baseInput = {
  gitRoot: '/repo',
  workflowRunId: 'workflow-1',
  executionSessionId: 'session-1',
  chatPrompt: 'Do work',
  apiBaseUrl: 'https://flowx.example',
  mcpToken: 'token-1',
  mcpEntryPath: '/tools/flowx-mcp/dist/index.js',
};

describe('CursorAdapter', () => {
  it('ensures project, writes prompt, and opens cursor', async () => {
    const ensureProject = vi.fn();
    const writePromptFile = vi.fn(() => '/repo/.flowx/tasks/workflow-1.md');
    const openIde = vi.fn(async () => ({ opened: true, prefilled: false }));
    const adapter = new CursorAdapter({ ensureProject, writePromptFile, openIde });

    await expect(adapter.launch(baseInput)).resolves.toEqual({
      ok: true,
      gitRoot: '/repo',
      ide: 'cursor',
      prefilled: false,
      promptPath: '/repo/.flowx/tasks/workflow-1.md',
      executionSessionId: 'session-1',
      workflowRunId: 'workflow-1',
    });

    expect(ensureProject).toHaveBeenCalledWith('/repo', {
      apiBaseUrl: 'https://flowx.example',
      mcpToken: 'token-1',
      mcpEntryPath: '/tools/flowx-mcp/dist/index.js',
    });
    expect(writePromptFile).toHaveBeenCalledWith('/repo', 'workflow-1', 'Do work');
    expect(openIde).toHaveBeenCalledWith('cursor', '/repo', 'Do work');
  });

  it('rejects missing executionSessionId', async () => {
    const adapter = new CursorAdapter({
      ensureProject: vi.fn(),
      writePromptFile: vi.fn(),
      openIde: vi.fn(),
    });

    await expect(
      adapter.launch({ ...baseInput, executionSessionId: '' }),
    ).rejects.toThrow(/executionSessionId/i);
  });
});

describe('CodexAdapter', () => {
  it('launches codex with the same handoff flow', async () => {
    const ensureProject = vi.fn();
    const writePromptFile = vi.fn(() => '/repo/.flowx/tasks/workflow-1.md');
    const openIde = vi.fn(async () => ({ opened: true, prefilled: false }));
    const adapter = new CodexAdapter({ ensureProject, writePromptFile, openIde });

    await expect(adapter.launch(baseInput)).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        gitRoot: '/repo',
        ide: 'codex',
        executionSessionId: 'session-1',
        workflowRunId: 'workflow-1',
      }),
    );

    expect(openIde).toHaveBeenCalledWith('codex', '/repo', 'Do work');
  });
});
