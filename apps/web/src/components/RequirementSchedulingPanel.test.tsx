// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { RequirementSchedulingPanel } from './RequirementSchedulingPanel';
import type { Requirement, RequirementAssignment } from '../types';
vi.mock('../api', () => ({ api: { getRequirementAssignments: vi.fn(), listProjectVersions: vi.fn(), updateRequirement: vi.fn(), deleteRequirementAssignment: vi.fn() } }));
vi.mock('./ScheduleAssignmentDialog', () => ({ ScheduleAssignmentDialog: () => null }));
vi.mock('./ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
const host = document.createElement('div'); document.body.append(host);
let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root.unmount()); vi.resetAllMocks(); });
it('排期逐页读取，人员总工时来自全范围汇总，已选版本不依赖首屏候选', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(host);
  vi.mocked(api.getRequirementAssignments).mockImplementation(async (_id, query) => ({
    items: [{ id: `assignment-${query?.page}`, userId: `成员${query?.page}`, role: 'DEVELOPER', plannedStartDate: '2026-11-02', plannedEndDate: '2026-11-06', estimatedDays: 5 } as RequirementAssignment],
    total: 25, page: query?.page ?? 1, pageSize: 20, totalPages: 2, summary: { estimatedDays: 125 },
  }));
  const requirement = { id: 'req', title: '需求', versionId: 'version-25', version: { id: 'version-25', name: '远页版本' }, project: { id: 'project', name: '项目' } } as Requirement;
  await act(async () => { root.render(<MemoryRouter><RequirementSchedulingPanel requirement={requirement} onChanged={vi.fn()} /></MemoryRouter>); });
  expect(host.textContent).toContain('125'); expect(host.textContent).toContain('远页版本');
  expect(api.listProjectVersions).not.toHaveBeenCalled();
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="第 2 页"]')!.click(); });
  expect(api.getRequirementAssignments).toHaveBeenLastCalledWith('req', expect.objectContaining({ page: 2, pageSize: 20 }));
  expect(host.textContent).toContain('成员2'); expect(host.textContent).toContain('125');
});
