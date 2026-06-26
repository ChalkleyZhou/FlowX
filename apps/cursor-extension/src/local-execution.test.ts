import { describe, expect, it, vi } from 'vitest';
import { claimAndHandoffLocalExecution, type ClaimLocalDeps } from './local-execution';
import type { FlowXTaskItem, LocalHandoffPayload } from './flowx-client';

const task: FlowXTaskItem = {
  id: 'req-1',
  type: 'requirement',
  title: '导出 CSV',
  status: 'in_progress',
  repository: { id: 'repo-1', name: 'flowx-web', url: 'git@x:flowx.git' },
  workflowRunId: 'run-1',
  eligible: true,
};

const handoff: LocalHandoffPayload = {
  workflowRunId: 'run-1',
  requirement: { id: 'req-1', title: '导出 CSV', description: 'desc', acceptanceCriteria: 'ac' },
  repositories: [{ workflowRepositoryId: 'wr-1', name: 'flowx-web', url: 'git@x:flowx.git', workingBranch: 'flowx/work/x' }],
};

function makeDeps(overrides: Partial<ClaimLocalDeps> = {}): ClaimLocalDeps {
  return {
    claimLocal: vi.fn().mockResolvedValue({}),
    getLocalHandoff: vi.fn().mockResolvedValue(handoff),
    getGitRoot: vi.fn().mockResolvedValue('/repo'),
    buildPrompt: vi.fn().mockReturnValue('PROMPT'),
    writeTaskFile: vi.fn().mockResolvedValue('/repo/.flowx/tasks/req-1.md'),
    saveHandoff: vi.fn().mockResolvedValue(undefined),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    openPromptInChat: vi.fn().mockResolvedValue(true),
    showError: vi.fn(),
    showInfo: vi.fn(),
    ...overrides,
  };
}

describe('claimAndHandoffLocalExecution', () => {
  it('claims, builds the prompt, writes it, and opens chat', async () => {
    const deps = makeDeps();
    await claimAndHandoffLocalExecution(deps, task);

    expect(deps.claimLocal).toHaveBeenCalledWith('run-1');
    expect(deps.getLocalHandoff).toHaveBeenCalledWith('run-1');
    expect(deps.buildPrompt).toHaveBeenCalledWith(task, handoff);
    expect(deps.writeTaskFile).toHaveBeenCalledWith('/repo', 'req-1', 'PROMPT');
    expect(deps.openPromptInChat).toHaveBeenCalledWith('PROMPT');
    expect(deps.showInfo).toHaveBeenCalled();
  });

  it('refuses to claim without a local git workspace', async () => {
    const deps = makeDeps({ getGitRoot: vi.fn().mockResolvedValue(null) });
    await claimAndHandoffLocalExecution(deps, task);

    expect(deps.claimLocal).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalled();
  });

  it('refuses when the task has no workflow run', async () => {
    const deps = makeDeps();
    await claimAndHandoffLocalExecution(deps, { ...task, workflowRunId: null });

    expect(deps.getGitRoot).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalled();
  });
});
