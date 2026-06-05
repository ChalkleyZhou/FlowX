import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPromptFromLocalHandoff, readTaskPromptFile, startInChat, writeTaskPromptFile } from './handoff';
import type { FlowXTaskItem } from './flowx-client';

const task: FlowXTaskItem = {
  eligible: true,
  id: 'req-1',
  repository: {
    id: 'repo-1',
    name: 'FlowX',
    url: 'https://github.com/flowx-ai/flowx.git',
  },
  status: 'ACTIVE',
  title: 'Add local handoff',
  type: 'requirement',
  workflowRunId: null,
};

function createDeps(overrides: Partial<Parameters<typeof startInChat>[0]> = {}) {
  return {
    copyToClipboard: vi.fn(),
    executeCommand: vi.fn(),
    getGitReport: vi.fn().mockResolvedValue({
      currentRemoteUrl: 'git@github.com:flowx-ai/flowx.git',
      dirty: false,
      gitRoot: '/repo/flowx',
    }),
    showError: vi.fn(),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
    startHandoff: vi.fn().mockResolvedValue({
      chatPrompt: '# FlowX handoff',
      handoff: { workflowRunId: 'workflow-1' },
      taskId: 'req-1',
      taskType: 'requirement',
      workflow: { id: 'workflow-1' },
    }),
    writeTaskFile: vi.fn().mockResolvedValue('/repo/flowx/.flowx/tasks/req-1.md'),
    ...overrides,
  };
}

describe('startInChat', () => {
  it('writes and copies the handoff prompt when the repository matches', async () => {
    const deps = createDeps();

    await startInChat(deps, task);

    expect(deps.startHandoff).toHaveBeenCalledWith({
      repositoryIds: ['repo-1'],
      taskId: 'req-1',
      taskType: 'requirement',
    });
    expect(deps.writeTaskFile).toHaveBeenCalledWith('/repo/flowx', 'req-1', '# FlowX handoff');
    expect(deps.copyToClipboard).toHaveBeenCalledWith('# FlowX handoff');
    expect(deps.executeCommand).toHaveBeenCalledWith('workbench.action.chat.open');
  });

  it('blocks when the local repository does not match FlowX', async () => {
    const deps = createDeps({
      getGitReport: vi.fn().mockResolvedValue({
        currentRemoteUrl: 'git@github.com:flowx-ai/other.git',
        dirty: false,
        gitRoot: '/repo/other',
      }),
    });

    await startInChat(deps, task);

    expect(deps.startHandoff).not.toHaveBeenCalled();
    expect(deps.showError).toHaveBeenCalledWith(expect.stringContaining('Repository mismatch'));
  });

  it('allows handoff when only the FlowX repository name matches the local remote', async () => {
    const deps = createDeps({
      getGitReport: vi.fn().mockResolvedValue({
        currentRemoteUrl: 'git@gitlab.rokid-inc.com:a2d2/a2os.git',
        dirty: false,
        gitRoot: '/repo/a2os',
      }),
    });

    await startInChat(deps, {
      ...task,
      repository: {
        id: 'repo-1',
        name: 'a2os',
        url: null,
      },
    });

    expect(deps.showError).not.toHaveBeenCalled();
    expect(deps.startHandoff).toHaveBeenCalledWith({
      repositoryIds: ['repo-1'],
      taskId: 'req-1',
      taskType: 'requirement',
    });
  });

  it('lets the user cancel when the local tree is dirty', async () => {
    const deps = createDeps({
      getGitReport: vi.fn().mockResolvedValue({
        currentRemoteUrl: 'git@github.com:flowx-ai/flowx.git',
        dirty: true,
        gitRoot: '/repo/flowx',
      }),
      showWarning: vi.fn().mockResolvedValue('Cancel'),
    });

    await startInChat(deps, task);

    expect(deps.startHandoff).not.toHaveBeenCalled();
    expect(deps.writeTaskFile).not.toHaveBeenCalled();
  });
});

describe('task prompt files', () => {
  it('reads a saved FlowX prompt', async () => {
    const gitRoot = await mkdtemp(path.join(tmpdir(), 'flowx-prompt-'));
    try {
      await writeTaskPromptFile(gitRoot, 'req-1', '# FlowX handoff');

      await expect(readTaskPromptFile(gitRoot, 'req-1')).resolves.toBe('# FlowX handoff');
    } finally {
      await rm(gitRoot, { force: true, recursive: true });
    }
  });

  it('rebuilds a FlowX prompt from active local handoff metadata', () => {
    const prompt = buildPromptFromLocalHandoff(task, {
      workflowRunId: 'workflow-1',
      requirement: {
        id: 'req-1',
        title: 'Add local handoff',
        description: 'Implement local chat handoff',
        acceptanceCriteria: 'Prompt can be copied again',
      },
      repositories: [
        {
          workflowRepositoryId: 'workflow-repo-1',
          name: 'FlowX',
          url: 'https://github.com/flowx-ai/flowx.git',
          workingBranch: 'flowx/work/local-handoff/workflow-1',
        },
      ],
    });

    expect(prompt).toContain('# FlowX Requirement: Add local handoff');
    expect(prompt).toContain('- Workflow run id: workflow-1');
    expect(prompt).toContain('- Working branch: flowx/work/local-handoff/workflow-1');
    expect(prompt).toContain('Prompt can be copied again');
  });
});
