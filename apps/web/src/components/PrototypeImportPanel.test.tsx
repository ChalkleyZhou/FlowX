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
vi.mock('../api', () => ({ api: { getPrototypeImport: vi.fn(), previewPrototypeImport: vi.fn(), analyzePrototypeImport: vi.fn(), supplementPrototypeImport: vi.fn(), downloadPrototypeImport: vi.fn(), confirmPrototypeImport: vi.fn(), createWorkflowRun: vi.fn() } }));
const record: PrototypeImport = { id: 'import-1', requirementId: 'req-1', status: 'ANALYZING', revision: 1, materialRevision: 1, aiProvider: 'codex', goal: '', manifest: { files: [], pages: [{ path: 'index.html', title: '看板' }], kinds: ['html'], sources: [{ name: '原型.zip', revision: 1 }], warnings: [] }, analysis: null, answers: {}, errorMessage: null };
describe('原型快速导入', () => {
  let container: HTMLDivElement, root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    vi.mocked(api.getPrototypeImport).mockResolvedValue(record);
    vi.mocked(api.previewPrototypeImport).mockResolvedValue({ html: '<button>新增</button>', warnings: [] });
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks(); vi.useRealTimers(); });
  async function render() { await act(async () => { root.render(<MemoryRouter initialEntries={['/?importing=1']}><PrototypeImportPanel importId="import-1" onConfirmed={vi.fn()} /></MemoryRouter>); }); }
  const button = (text: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text);
  it('只展示导入进度，无需回答问题、保存草稿或确认', async () => {
    await render();
    expect(container.textContent).toContain('正在导入');
    expect(container.textContent).not.toContain('确认方案');
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(api.confirmPrototypeImport).not.toHaveBeenCalled();
  });
  it('后台成功后自动进入服务端创建的流程，不在浏览器重复创建', async () => {
    vi.useFakeTimers(); await render();
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'CONFIRMED', workflowRunId: 'run-auto' });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(navigate).toHaveBeenCalledWith('/workflow-runs/run-auto', { replace: true });
    expect(api.createWorkflowRun).not.toHaveBeenCalled();
    expect(api.confirmPrototypeImport).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(api.getPrototypeImport).toHaveBeenCalledTimes(2);
  });
  it('资料已落库但流程尚未接入时继续等待，不展示成功或让人再次启动', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'CONFIRMED', workflowRunId: null });
    await render();
    expect(container.textContent).toContain('正在导入');
    expect(container.textContent).not.toContain('导入成功');
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'CONFIRMED', workflowRunId: 'run-ready' });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(navigate).toHaveBeenCalledWith('/workflow-runs/run-ready', { replace: true });
  });
  it('失败直接说明原因，点击重试使用现有材料和当前修订', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'FAILED', revision: 3, errorMessage: '请检查项目代码仓库' });
    vi.mocked(api.analyzePrototypeImport).mockResolvedValue({ ...record, revision: 4 });
    await render();
    expect(container.textContent).toContain('请检查项目代码仓库');
    await act(async () => { button('重新导入')?.click(); });
    expect(api.analyzePrototypeImport).toHaveBeenCalledWith('import-1', { revision: 3, aiProvider: 'codex' });
    expect(container.textContent).toContain('正在导入');
  });
  it('失败后可切换 AI 重试，无需重新上传，提交失败保留选择', async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'FAILED', revision: 3 });
    vi.mocked(api.analyzePrototypeImport).mockRejectedValueOnce(new Error('网络中断'));
    await render();
    const trigger = container.querySelector('[aria-label="使用的 AI"]')!;
    expect(trigger?.textContent).toBe('Codex');
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { (Array.from(document.querySelectorAll('[role="option"]')).find((item) => item.textContent === 'Cursor CLI') as HTMLElement).click(); });
    await act(async () => { button('重新导入')!.click(); });
    expect(api.analyzePrototypeImport).toHaveBeenCalledWith('import-1', { revision: 3, aiProvider: 'cursor' });
    expect(container.textContent).toContain('网络中断');
    expect(trigger.textContent).toBe('Cursor CLI');
    expect(api.supplementPrototypeImport).not.toHaveBeenCalled();
    let resolveRetry!: (value: PrototypeImport) => void;
    vi.mocked(api.analyzePrototypeImport).mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; }));
    await act(async () => { button('重新导入')!.click(); button('重新导入')?.click(); });
    expect(api.analyzePrototypeImport).toHaveBeenCalledTimes(2);
    expect(trigger.hasAttribute('disabled')).toBe(true);
    await act(async () => { resolveRetry({ ...record, aiProvider: 'cursor', revision: 4 }); });
    expect(container.textContent).toContain('正在导入');
  });
  it('旧等待确认记录自动接续，无需点击确认', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'WAITING_CONFIRMATION' });
    vi.mocked(api.analyzePrototypeImport).mockResolvedValue({ ...record, revision: 2 });
    await render();
    expect(api.analyzePrototypeImport).toHaveBeenCalledTimes(1);
    expect(api.analyzePrototypeImport).toHaveBeenCalledWith('import-1', { revision: 1 });
    expect(api.confirmPrototypeImport).not.toHaveBeenCalled();
  });
  it('补传 ZIP 并重试也使用当前选中的 AI', async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'FAILED' });
    vi.mocked(api.supplementPrototypeImport).mockResolvedValue({ ...record, aiProvider: 'cursor', revision: 2 });
    await render();
    await act(async () => { container.querySelector('[aria-label="使用的 AI"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { (Array.from(document.querySelectorAll('[role="option"]')).find((item) => item.textContent === 'Cursor CLI') as HTMLElement).click(); });
    const file = new File(['zip'], 'more.zip');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { button('重新导入')!.click(); });
    expect(api.supplementPrototypeImport).toHaveBeenCalledWith('import-1', 1, file, 'cursor', true);
    expect(api.analyzePrototypeImport).not.toHaveBeenCalled();
    expect(container.textContent).toContain('正在导入');
  });
  it('选择新包后可撤销，恢复用原包重新导入，非法包不能提交', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'FAILED' });
    vi.mocked(api.analyzePrototypeImport).mockResolvedValue({ ...record, revision: 2 });
    await render();
    expect(container.textContent).toContain('原型.zip');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['bad'], 'bad.txt')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(button('重新导入')?.disabled).toBe(true);
    await act(async () => { button('移除新 ZIP')!.click(); });
    expect(button('重新导入')?.disabled).toBe(false);
    await act(async () => { button('重新导入')!.click(); });
    expect(api.analyzePrototypeImport).toHaveBeenCalledWith('import-1', { revision: 1, aiProvider: 'codex' });
    expect(api.supplementPrototypeImport).not.toHaveBeenCalled();
  });
  it('换包请求失败后刷新修订并保留文件和 AI，再试使用最新修订', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValueOnce({ ...record, status: 'FAILED' }).mockResolvedValue({ ...record, status: 'FAILED', revision: 2 });
    vi.mocked(api.supplementPrototypeImport).mockRejectedValueOnce(new Error('原型包读取失败')).mockResolvedValueOnce({ ...record, revision: 3 });
    await render();
    const file = new File(['zip'], 'new.zip');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { button('重新导入')!.click(); });
    expect(container.textContent).toContain('new.zip');
    await act(async () => { button('重新导入')!.click(); });
    expect(api.supplementPrototypeImport).toHaveBeenLastCalledWith('import-1', 2, file, 'codex', true);
  });
  it('轮询保持进度内容、不重叠请求，失败后停止', async () => {
    vi.useFakeTimers(); await render();
    let resolvePoll!: (value: PrototypeImport) => void;
    vi.mocked(api.getPrototypeImport).mockReturnValueOnce(new Promise((resolve) => { resolvePoll = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(api.getPrototypeImport).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('正在导入');
    await act(async () => { resolvePoll({ ...record, status: 'FAILED' }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(api.getPrototypeImport).toHaveBeenCalledTimes(2);
  });
  it('StrictMode 和切换导入时旧响应不跳转到错误流程', async () => {
    let resolveOld!: (value: PrototypeImport) => void;
    vi.mocked(api.getPrototypeImport).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue(record);
    await act(async () => { root.render(<StrictMode><MemoryRouter initialEntries={['/?importing=1']}><PrototypeImportPanel importId="import-1" onConfirmed={vi.fn()} /></MemoryRouter></StrictMode>); });
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, id: 'import-2', status: 'CONFIRMED', workflowRunId: 'run-new' });
    await act(async () => { root.render(<StrictMode><MemoryRouter initialEntries={['/?importing=1']}><PrototypeImportPanel importId="import-2" onConfirmed={vi.fn()} /></MemoryRouter></StrictMode>); });
    await act(async () => { resolveOld({ ...record, status: 'CONFIRMED', workflowRunId: 'run-old' }); });
    expect(navigate).toHaveBeenCalledWith('/workflow-runs/run-new', { replace: true });
    expect(navigate).not.toHaveBeenCalledWith('/workflow-runs/run-old', expect.anything());
  });
  it('稍后从需求详情查看已完成导入时保留详情，不强制跳走', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'CONFIRMED', workflowRunId: 'run-existing' });
    await act(async () => { root.render(<MemoryRouter><PrototypeImportPanel importId="import-1" onConfirmed={vi.fn()} /></MemoryRouter>); });
    expect(navigate).not.toHaveBeenCalled();
    expect(container.querySelector('a[href="/workflow-runs/run-existing"]')).toBeTruthy();
  });
  it('父页面已有 CREATED 流程不能绕过导入接续状态', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'CONFIRMED', workflowRunId: null });
    await act(async () => { root.render(<MemoryRouter><PrototypeImportPanel importId="import-1" existingWorkflowId="run-created" onConfirmed={vi.fn()} /></MemoryRouter>); });
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('正在导入');
    expect(container.textContent).not.toContain('导入成功');
  });
  it('需求变更重走流程后，已完成导入入口跟随当前轮次', async () => {
    vi.mocked(api.getPrototypeImport).mockResolvedValue({ ...record, status: 'CONFIRMED', workflowRunId: 'run-original' });
    await act(async () => { root.render(<MemoryRouter><PrototypeImportPanel importId="import-1" existingWorkflowId="run-restarted" onConfirmed={vi.fn()} /></MemoryRouter>); });
    expect(container.querySelector('a[href="/workflow-runs/run-restarted"]')).toBeTruthy();
    expect(container.querySelector('a[href="/workflow-runs/run-original"]')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('材料按需展开预览，预览失败不阻断导入', async () => {
    await render();
    expect(api.previewPrototypeImport).not.toHaveBeenCalled();
    await act(async () => { button('查看原型与材料')?.click(); });
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(container.textContent).toContain('正在导入');
  });
});
