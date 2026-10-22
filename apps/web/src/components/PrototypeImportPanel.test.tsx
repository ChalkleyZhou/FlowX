// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { PrototypeImport } from '../types';
import { PrototypeImportPanel } from './PrototypeImportPanel';
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(), useNavigate: () => navigate }));
vi.mock('../api', () => ({ api: { getPrototypeImport: vi.fn(), previewPrototypeImport: vi.fn(), savePrototypeImport: vi.fn(), analyzePrototypeImport: vi.fn(), confirmPrototypeImport: vi.fn(), supplementPrototypeImport: vi.fn(), downloadPrototypeImport: vi.fn(), createWorkflowRun: vi.fn() } }));
const analysis = { title: '事项管理', description: '事项看板', acceptanceCriteria: ['能创建事项'], brief: { expandedDescription: '事项管理', userStories: [], edgeCases: [], successMetrics: [], openQuestions: [], assumptions: [], outOfScope: [] }, design: { overview: '列表布局', pages: [], demoScenario: '新增', designRationale: '原型' }, clarifications: [{ id: 'permission', required: true, question: '谁可以删除？', suggestedAnswer: '创建人' }], evidence: [{ path: 'index.html', observation: '新增按钮' }], inferences: ['权限待定'] };
const record = { id: 'import-1', requirementId: 'req-1', status: 'WAITING_CONFIRMATION' as const, revision: 1, materialRevision: 1, aiProvider: 'codex' as const, goal: '', manifest: { files: [{ path: 'index.html', bytes: 100, kind: 'html' as const }], pages: [{ path: 'index.html', title: '看板' }], kinds: ['html'], sources: [{ name: '原型.zip', revision: 1 }], warnings: [] }, analysis, answers: {}, errorMessage: null };
describe('原型导入确认', () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    vi.mocked(api.getPrototypeImport).mockResolvedValue(record);
    vi.mocked(api.previewPrototypeImport).mockResolvedValue({ html: '<button>新增</button>', warnings: [] });
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks(); vi.useRealTimers(); });
  async function render() { await act(async () => { root.render(<MemoryRouter><PrototypeImportPanel importId="import-1" onConfirmed={vi.fn()} /></MemoryRouter>); }); }
  it('集中展示原型、可编辑草稿、依据和关键问题，未答不能确认', async () => {
    await render();
    expect(container.textContent).toContain('谁可以删除？');
    expect(container.textContent).toContain('新增按钮');
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '确认方案，继续研发');
    expect(button?.disabled).toBe(true);
    expect(api.confirmPrototypeImport).not.toHaveBeenCalled();
  });
  it('保存答案后一次确认接续，不重新生成构思或设计', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, answers: { permission: '仅创建人' } });
    vi.mocked(api.confirmPrototypeImport).mockResolvedValue({ ...record, status: 'CONFIRMED', revision: 2, answers: { permission: '仅创建人' } });
    vi.mocked(api.createWorkflowRun).mockResolvedValue({ id: 'run-1' } as never);
    await render();
    await act(async () => { Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '确认方案，继续研发')?.click(); });
    expect(api.confirmPrototypeImport).toHaveBeenCalledWith('import-1', expect.objectContaining({ revision: 1, answers: { permission: '仅创建人' } }));
    expect(api.createWorkflowRun).toHaveBeenCalledWith('req-1', undefined, 'codex');
    expect(navigate).toHaveBeenCalledWith('/workflow-runs/run-1');
  });
  it('已确认但创建工作流失败时保留结果，可直接继续重试', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'CONFIRMED' });
    vi.mocked(api.createWorkflowRun).mockRejectedValue(new Error('请先添加仓库'));
    await render();
    await act(async () => { Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '继续研发')?.click(); });
    expect(container.textContent).toContain('请先添加仓库');
    expect(api.confirmPrototypeImport).not.toHaveBeenCalled();
    expect(container.textContent).toContain('已确认');
  });
  it('失败仍展示已有原型和草稿，并可重试', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'FAILED', errorMessage: 'AI 整理失败' });
    await render();
    expect(container.textContent).toContain('AI 整理失败');
    expect(container.querySelector('iframe')).toBeTruthy();
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === '重试整理')).toBe(true);
  });
  it('采用建议后才满足必答，刷新不覆盖本地草稿和修订基线', async () => {
    await render();
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '采用建议')?.click(); });
    const confirm = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '确认方案，继续研发');
    expect(confirm?.disabled).toBe(false);
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, revision: 2, answers: {}, analysis: { ...analysis, title: '服务器的新标题' } });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '刷新原型状态')?.click(); });
    expect((container.querySelector('[aria-label="需求标题"]') as HTMLInputElement).value).toBe('事项管理');
    expect((container.querySelector('#prototype-answer-permission') as HTMLTextAreaElement).value).toBe('创建人');
    expect(container.textContent).not.toContain('正在加载原型');
    expect(container.textContent).toContain('服务端已有新版本');
    vi.mocked(api.savePrototypeImport).mockResolvedValue({ ...record, revision: 3, answers: { permission: '创建人' } });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '保存草稿')?.click(); });
    expect(api.savePrototypeImport).toHaveBeenCalledWith('import-1', expect.objectContaining({ revision: 1, analysis, answers: { permission: '创建人' } }));
  });

  it('后台轮询保持已有内容、不重叠请求，终态停止', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'ANALYZING' });
    await render();
    let resolvePoll!: (value: PrototypeImport) => void;
    vi.mocked(api.getPrototypeImport).mockReturnValueOnce(new Promise((resolve) => { resolvePoll = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(api.getPrototypeImport).toHaveBeenCalledTimes(2);
    expect(container.querySelector('iframe')).toBeTruthy();
    expect(container.querySelector('[aria-label="需求标题"]')).toBeTruthy();
    await act(async () => { resolvePoll(record); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(api.getPrototypeImport).toHaveBeenCalledTimes(2);
  });

  it('StrictMode 和切换导入时忽略旧响应', async () => {
    let resolveOld!: (value: PrototypeImport) => void;
    vi.mocked(api.getPrototypeImport).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue({ ...record, id: 'import-2', analysis: { ...analysis, title: '新的原型需求' } });
    await act(async () => { root.render(<StrictMode><MemoryRouter><PrototypeImportPanel importId="import-1" onConfirmed={vi.fn()} /></MemoryRouter></StrictMode>); });
    await act(async () => { root.render(<StrictMode><MemoryRouter><PrototypeImportPanel importId="import-2" onConfirmed={vi.fn()} /></MemoryRouter></StrictMode>); });
    await act(async () => { resolveOld(record); });
    expect((container.querySelector('[aria-label="需求标题"]') as HTMLInputElement).value).toBe('新的原型需求');
  });

  it('原型导航仅接受当前 iframe 且页面在清单内', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, manifest: { ...record.manifest, pages: [...record.manifest.pages, { path: 'detail.html', title: '详情' }] } });
    await render();
    const iframe = container.querySelector('iframe')!;
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'flowx-prototype-navigate', path: 'detail.html' } }));
      window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow, data: { type: 'flowx-prototype-navigate', path: '../outside.html' } }));
    });
    expect(api.previewPrototypeImport).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow, data: { type: 'flowx-prototype-navigate', path: 'detail.html' } })); });
    expect(api.previewPrototypeImport).toHaveBeenLastCalledWith('import-1', 'detail.html');
  });

  it('预览失败可单独重试，不丢失需求草稿', async () => {
    vi.mocked(api.previewPrototypeImport).mockRejectedValueOnce(new Error('预览暂时不可用'));
    await render();
    expect(container.textContent).toContain('预览暂时不可用');
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '重试预览')?.click(); });
    expect(container.querySelector('iframe')).toBeTruthy();
    expect(container.querySelector('[aria-label="需求标题"]')).toBeTruthy();
  });

  it('已有工作流时提供接续链接，避免重复创建', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'CONFIRMED' });
    await act(async () => { root.render(<MemoryRouter><PrototypeImportPanel importId="import-1" existingWorkflowId="run-existing" onConfirmed={vi.fn()} /></MemoryRouter>); });
    expect(container.querySelector('a[href="/workflow-runs/run-existing"]')?.textContent).toBe('继续研发');
    expect(api.createWorkflowRun).not.toHaveBeenCalled();
  });

  it('确认后的创建失败保留确认结果，再次继续不重新确认', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, answers: { permission: '创建人' } });
    vi.mocked(api.confirmPrototypeImport).mockResolvedValue({ ...record, status: 'CONFIRMED', revision: 2 });
    vi.mocked(api.createWorkflowRun).mockRejectedValueOnce(new Error('缺少仓库')).mockResolvedValueOnce({ id: 'run-retry' } as Awaited<ReturnType<typeof api.createWorkflowRun>>);
    await render();
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '确认方案，继续研发')?.click(); });
    expect(container.textContent).toContain('已确认');
    expect(container.textContent).toContain('缺少仓库');
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '继续研发')?.click(); });
    expect(api.confirmPrototypeImport).toHaveBeenCalledTimes(1);
    expect(api.createWorkflowRun).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('/workflow-runs/run-retry');
  });

  it('下载来源使用受保护 API 并回收 Blob URL', async () => {
    vi.useFakeTimers();
    const createUrl = vi.fn(() => 'blob:prototype-source');
    const revokeUrl = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = revokeUrl;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      vi.mocked(api.downloadPrototypeImport).mockResolvedValue(new Blob(['zip']));
      await render();
      await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.startsWith('下载 原型.zip'))?.click(); });
      expect(api.downloadPrototypeImport).toHaveBeenCalledWith('import-1', 1);
      expect(createUrl).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(revokeUrl).toHaveBeenCalledWith('blob:prototype-source');
    } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; click.mockRestore(); }
  });

  it('保存期间旧刷新迟到不会回退修订，也不会产生重叠刷新', async () => {
    await render();
    let resolveRefresh!: (value: PrototypeImport) => void;
    vi.mocked(api.getPrototypeImport).mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
    vi.mocked(api.savePrototypeImport).mockResolvedValue({ ...record, revision: 2, answers: { permission: '已保存' } });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '刷新原型状态')?.click(); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '保存草稿')?.click(); });
    await act(async () => { resolveRefresh(record); });
    expect((container.querySelector('#prototype-answer-permission') as HTMLTextAreaElement).value).toBe('已保存');
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '保存草稿')?.click(); });
    expect(api.savePrototypeImport).toHaveBeenLastCalledWith('import-1', expect.objectContaining({ revision: 2 }));
  });

  it('保存冲突保留本地编辑，显式载入最新后才更新提交基线', async () => {
    await render();
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '采用建议')?.click(); });
    vi.mocked(api.savePrototypeImport).mockRejectedValueOnce(Object.assign(new Error('版本冲突，请刷新'), { status: 409 }));
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '保存草稿')?.click(); });
    expect(container.textContent).toContain('服务端已有新版本');
    expect((container.querySelector('#prototype-answer-permission') as HTMLTextAreaElement).value).toBe('创建人');
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, revision: 2, analysis: { ...analysis, title: '其他人保存的需求' }, answers: { permission: '管理员' } });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '放弃本地编辑，载入最新版本')?.click(); });
    expect((container.querySelector('[aria-label="需求标题"]') as HTMLInputElement).value).toBe('其他人保存的需求');
    expect((container.querySelector('#prototype-answer-permission') as HTMLTextAreaElement).value).toBe('管理员');
    expect(container.textContent).not.toContain('服务端已有新版本');
    vi.mocked(api.savePrototypeImport).mockResolvedValue({ ...record, revision: 3 });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '保存草稿')?.click(); });
    expect(api.savePrototypeImport).toHaveBeenLastCalledWith('import-1', expect.objectContaining({ revision: 2, answers: { permission: '管理员' } }));
  });

  it('刷新发现新版本后，确认也仍使用草稿原始基线', async () => {
    await render();
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '采用建议')?.click(); });
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, revision: 2, answers: { permission: '管理员' } });
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '刷新原型状态')?.click(); });
    vi.mocked(api.confirmPrototypeImport).mockRejectedValueOnce(Object.assign(new Error('版本冲突'), { status: 409 }));
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '确认方案，继续研发')?.click(); });
    expect(api.confirmPrototypeImport).toHaveBeenCalledWith('import-1', expect.objectContaining({ revision: 1, answers: { permission: '创建人' } }));
    expect(api.createWorkflowRun).not.toHaveBeenCalled();
    expect((container.querySelector('#prototype-answer-permission') as HTMLTextAreaElement).value).toBe('创建人');
  });

});
