// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { Project } from '../types';
import { ProjectDetailPage } from './ProjectDetailPage';

const { successToast, errorToast } = vi.hoisted(() => ({ successToast: vi.fn(), errorToast: vi.fn() }));
vi.mock('../api', () => ({ api: { getProject: vi.fn(), createRequirement: vi.fn(), createPrototypeImport: vi.fn() } }));
vi.mock('../components/ui/toast', () => ({ useToast: () => ({ success: successToast, error: errorToast }) }));
vi.mock('../components/ProjectBriefingConfigPanel', () => ({ ProjectBriefingConfigPanel: () => null }));
vi.mock('../components/ProjectCodeReviewConfigPanel', () => ({ ProjectCodeReviewConfigPanel: () => null }));
vi.mock('../components/ProjectVersionsPanel', () => ({ ProjectVersionsPanel: () => <div>版本管理</div> }));

function LocationProbe() { const location = useLocation(); return <output>{location.pathname}</output>; }

const project: Project = {
  id: 'project-1', name: 'FlowX', workspace: { id: 'ws-1', name: '研发平台', repositories: [] },
  currentVersionId: 'ver-current', currentVersion: { id: 'ver-current', name: '2.6.0' },
  versions: [{ id: 'ver-current', name: '2.6.0' }], requirements: [],
};

describe('项目页快捷创建需求', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    window.localStorage.clear();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetAllMocks();
    vi.mocked(api.getProject).mockResolvedValue(project);
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });

  async function openCreate() {
    await act(async () => { root.render(<MemoryRouter initialEntries={['/projects/project-1']}><Routes><Route path="/projects/:projectId" element={<ProjectDetailPage />} /><Route path="/requirements/:id" element={<LocationProbe />} /></Routes></MemoryRouter>); });
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '新建需求');
    expect(button).toBeTruthy();
    await act(async () => { button!.click(); });
  }
  async function fillTitle(value: string) {
    const input = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function submit() {
    await act(async () => { document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  }

  it('只填标题即可新建到当前版本，刷新列表并保持在项目页', async () => {
    vi.mocked(api.createRequirement).mockResolvedValue({ id: 'req-1' } as Awaited<ReturnType<typeof api.createRequirement>>);
    await openCreate();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('2.6.0');
    expect(document.querySelectorAll('[role="dialog"] input:not([type="file"])')).toHaveLength(1);
    await fillTitle('  快速需求  '); await submit();
    expect(api.createRequirement).toHaveBeenCalledWith({ projectId: 'project-1', title: '快速需求', versionId: 'ver-current' });
    expect(api.getProject).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(successToast).toHaveBeenCalled();
  });

  it('失败保留标题可重试，提交中不能重复创建或关闭', async () => {
    vi.mocked(api.createRequirement).mockRejectedValueOnce(new Error('网络中断'));
    await openCreate(); await fillTitle('保留标题'); await submit();
    expect(errorToast).toHaveBeenCalledWith('网络中断');
    expect((document.querySelector('[role="dialog"] input') as HTMLInputElement).value).toBe('保留标题');
    let resolveCreate!: (value: Awaited<ReturnType<typeof api.createRequirement>>) => void;
    vi.mocked(api.createRequirement).mockReturnValueOnce(new Promise((resolve) => { resolveCreate = resolve; }));
    await submit(); await submit();
    expect(api.createRequirement).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"] button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    await act(async () => { Array.from(document.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent === 'Close')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => { resolveCreate({ id: 'req-1' } as Awaited<ReturnType<typeof api.createRequirement>>); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('没有当前版本时提示设置，且阻止快捷创建', async () => {
    vi.mocked(api.getProject).mockResolvedValue({ ...project, currentVersionId: null, currentVersion: null });
    await openCreate();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('请先设置项目当前版本');
    expect(document.querySelector('[role="dialog"] button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    expect(api.createRequirement).not.toHaveBeenCalled();
  });
  async function chooseZip(file: File) {
    const input = document.querySelector('[role="dialog"] input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  }

  it('快捷创建可选传 ZIP，携带标题和弹窗版本，只创建一次并进入原型详情', async () => {
    await openCreate(); await fillTitle('原型快捷需求');
    const file = new File(['zip'], 'design.zip', { type: 'application/zip' });
    await chooseZip(file);
    let resolveUpload!: (value: Awaited<ReturnType<typeof api.createPrototypeImport>>) => void;
    vi.mocked(api.createPrototypeImport).mockReturnValueOnce(new Promise((resolve) => { resolveUpload = resolve; }));
    await submit(); await submit();
    expect(api.createPrototypeImport).toHaveBeenCalledTimes(1);
    expect(api.createPrototypeImport).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', title: '原型快捷需求', versionId: 'ver-current' }), file);
    expect(api.createRequirement).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"] button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    await act(async () => { Array.from(document.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent === 'Close')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => { resolveUpload({ requirementId: 'req-import' } as Awaited<ReturnType<typeof api.createPrototypeImport>>); });
    expect(container.textContent).toBe('/requirements/req-import');
  });

  it('ZIP 上传失败保留标题和文件，可用原文件重试', async () => {
    await openCreate(); await fillTitle('保留原型');
    const file = new File(['zip'], 'design.zip'); await chooseZip(file);
    vi.mocked(api.createPrototypeImport).mockRejectedValueOnce(new Error('上传失败，请重试'));
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('上传失败，请重试');
    expect((document.querySelector('#quick-requirement-title') as HTMLInputElement).value).toBe('保留原型');
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).files?.[0]).toBe(file);
    vi.mocked(api.createPrototypeImport).mockResolvedValueOnce({ requirementId: 'req-import' } as Awaited<ReturnType<typeof api.createPrototypeImport>>);
    await submit();
    expect(api.createPrototypeImport).toHaveBeenLastCalledWith(expect.objectContaining({ title: '保留原型' }), file);
  });

  it('错误类型或超限文件不可提交，移除 ZIP 可继续普通创建', async () => {
    await openCreate(); await fillTitle('普通需求');
    for (const file of [new File(['bad'], 'design.txt'), Object.defineProperty(new File(['zip'], 'huge.zip'), 'size', { value: 20 * 1024 * 1024 + 1 })]) {
      await chooseZip(file); await submit();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('20 MiB');
      expect(api.createPrototypeImport).not.toHaveBeenCalled();
      expect(api.createRequirement).not.toHaveBeenCalled();
    }
    await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((button) => button.textContent === '移除 ZIP')?.click(); });
    vi.mocked(api.createRequirement).mockResolvedValue({ id: 'req-1' } as Awaited<ReturnType<typeof api.createRequirement>>);
    await submit();
    expect(api.createRequirement).toHaveBeenCalledWith({ projectId: 'project-1', title: '普通需求', versionId: 'ver-current' });
  });

});
