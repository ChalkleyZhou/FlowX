// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { Requirement } from '../types';
import { RequirementsPage } from './RequirementsPage';

const {
  probeFlowxLocal,
  launchOpenDesignLocal,
  successToast,
  errorToast,
} = vi.hoisted(() => ({
  probeFlowxLocal: vi.fn(),
  launchOpenDesignLocal: vi.fn(),
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getWorkspaces: vi.fn(),
    getProjects: vi.fn(),
    getRequirements: vi.fn(),
    getWorkflowProviders: vi.fn(),
    createRequirement: vi.fn(),
    createWorkflowRun: vi.fn(),
    startOpenDesignHandoff: vi.fn(),
  },
  getFlowxApiBaseUrl: () => 'http://127.0.0.1:3000',
}));

vi.mock('../lib/flowx-local-bridge', () => ({
  probeFlowxLocal,
  launchOpenDesignLocal,
}));

vi.mock('../components/ui/toast', () => ({
  useToast: () => ({ success: successToast, error: errorToast }),
}));

describe('RequirementsPage', () => {
  let container: HTMLDivElement;
  let root: Root | null;

  const requirement: Requirement = {
    id: 'requirement-1',
    title: '端云设计闭环',
    description: '设计师在本地 OpenDesign 完成设计并回传 FlowX。',
    acceptanceCriteria: '设计 Artifact 和 Evidence 可追溯。',
    ideationStatus: 'FINALIZED',
    project: {
      id: 'project-1',
      name: 'FlowX',
      workspace: {
        id: 'workspace-1',
        name: '研发平台',
        repositories: [
          { id: 'repository-1', name: 'flowx-web', url: 'https://example.com/flowx-web.git' },
        ],
      },
    },
    workflowRuns: [],
    requirementRepositories: [
      {
        id: 'scope-1',
        repository: {
          id: 'repository-1',
          name: 'flowx-web',
          url: 'https://example.com/flowx-web.git',
        },
      },
    ],
  };

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    successToast.mockReset();
    errorToast.mockReset();

    vi.mocked(api.getWorkspaces).mockResolvedValue([requirement.project.workspace]);
    vi.mocked(api.getProjects).mockResolvedValue([requirement.project]);
    vi.mocked(api.getRequirements).mockResolvedValue([requirement]);
    vi.mocked(api.getWorkflowProviders).mockResolvedValue({
      defaultProvider: 'codex',
      providers: [
        { id: 'codex', label: 'Codex' },
        { id: 'cursor', label: 'Cursor CLI' },
      ],
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('creates an OpenDesign handoff, launches flowx-local, and opens the workflow', async () => {
    vi.mocked(api.startOpenDesignHandoff).mockResolvedValue({
      workflow: { id: 'workflow-1' },
      handoff: { executionSessionId: 'session-1' },
      ticket: 'ticket-1',
      loopbackPort: 3920,
    } as Awaited<ReturnType<typeof api.startOpenDesignHandoff>>);
    probeFlowxLocal.mockResolvedValue(true);
    launchOpenDesignLocal.mockResolvedValue({
      ok: true,
      executionSessionId: 'session-1',
      workspacePath: '/tmp/design-session',
      contextPath: '/tmp/design-session/context.json',
      resultPath: '/tmp/design-session/result.json',
      opened: true,
    });

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/requirements']}>
          <Routes>
            <Route path="/requirements" element={<RequirementsPage />} />
            <Route path="/workflow-runs/:workflowRunId" element={<div>workflow-detail</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === 'OpenDesign 设计',
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.startOpenDesignHandoff).toHaveBeenCalledWith(
      'requirement-1',
      ['repository-1'],
    );
    expect(probeFlowxLocal).toHaveBeenCalledWith(3920);
    expect(launchOpenDesignLocal).toHaveBeenCalledWith(
      { ticket: 'ticket-1', apiBaseUrl: 'http://127.0.0.1:3000' },
      3920,
    );
    expect(successToast).toHaveBeenCalledWith(
      'OpenDesign 本地设计目录已打开：/tmp/design-session',
    );
    expect(container.textContent).toContain('workflow-detail');
    expect(errorToast).not.toHaveBeenCalled();
  });
});
