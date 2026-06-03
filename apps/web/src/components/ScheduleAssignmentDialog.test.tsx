// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleAssignmentDialog } from './ScheduleAssignmentDialog';
import { api } from '../api';
import { ToastProvider } from './ui/toast';

vi.mock('../api', () => ({
  api: {
    getOrganizationMembers: vi.fn(),
    getProjects: vi.fn(),
    getRequirements: vi.fn(),
    createRequirementAssignment: vi.fn(),
    updateRequirementAssignment: vi.fn(),
  },
}));

const members = [{ id: 'user-1', displayName: 'Alice' }];
const projects = [
  { id: 'proj-1', name: 'Alpha', workspace: { id: 'ws-1', name: 'WS', repositories: [] } },
];
const requirements = [
  {
    id: 'req-1',
    title: 'Login flow',
    description: '',
    acceptanceCriteria: '',
    ideationStatus: 'DRAFT',
    project: projects[0],
  },
];

describe('ScheduleAssignmentDialog', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(api.getOrganizationMembers).mockResolvedValue(members);
    vi.mocked(api.getProjects).mockResolvedValue(projects);
    vi.mocked(api.getRequirements).mockResolvedValue(requirements);
    vi.mocked(api.createRequirementAssignment).mockResolvedValue({
      id: 'asg-1',
      userId: 'user-1',
      role: 'FRONTEND',
      plannedStartDate: '2026-05-01',
      plannedEndDate: '2026-05-05',
      sortOrder: 0,
    });
    onSaved.mockReset();
    onOpenChange.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    root = null;
  });

  function renderDialog(props: Partial<Parameters<typeof ScheduleAssignmentDialog>[0]> = {}) {
    act(() => {
      root?.render(
        <ToastProvider>
          <ScheduleAssignmentDialog
            open
            onOpenChange={onOpenChange}
            initialProjectId="proj-1"
            initialRequirementId="req-1"
            onSaved={onSaved}
            {...props}
          />
        </ToastProvider>,
      );
    });
  }

  it('shows project and requirement fields when creating from schedule hub', async () => {
    renderDialog();

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('新建排期');
    expect(document.body.textContent).toContain('项目');
    expect(document.body.textContent).toContain('需求');
    expect(document.body.textContent).toContain('成员');
    expect(document.body.textContent).toContain('角色');
  }, 10_000);

  it('hides project and requirement when requirement is fixed', async () => {
    renderDialog({
      fixedRequirementId: 'req-1',
      fixedRequirementTitle: 'Login flow',
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('添加排期');
    expect(document.body.textContent).toContain('Login flow');
    expect(document.body.textContent).not.toContain('选择项目');
  });

  it('keeps requirement disabled until a project is selected', async () => {
    renderDialog({ initialProjectId: '', initialRequirementId: '' });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('请先选择项目');
    const requirementTrigger = Array.from(
      document.body.querySelectorAll('[aria-label="选择需求"]'),
    ).at(0) as HTMLButtonElement | undefined;
    expect(requirementTrigger?.disabled).toBe(true);
  });

  it('creates assignment for selected requirement', async () => {
    renderDialog();

    await act(async () => {
      await Promise.resolve();
    });

    const form = document.body.querySelector('form');
    expect(form).toBeTruthy();

    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(api.createRequirementAssignment).toHaveBeenCalledWith(
      'req-1',
      expect.objectContaining({
        userId: 'user-1',
        role: 'FRONTEND',
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
