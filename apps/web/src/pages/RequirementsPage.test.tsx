// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { Requirement } from '../types';
import { RequirementsPage } from './RequirementsPage';

const { successToast, errorToast } = vi.hoisted(() => ({
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
  },
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

  it('does not expose OpenDesign launch from the requirements list', async () => {
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/requirements']}>
          <Routes>
            <Route path="/requirements" element={<RequirementsPage />} />
          </Routes>
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent?.trim() === 'OpenDesign 设计',
    );
    expect(button).toBeUndefined();
    expect(container.textContent).toContain('启动工作流');
  });
});
