// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { RequirementChange, RequirementChanges } from '../types';
import { RequirementChangesPanel } from './RequirementChangesPanel';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async original => ({ ...await original<typeof import('react-router-dom')>(), useNavigate: () => navigate }));
vi.mock('../api', () => ({ api: { getRequirementChanges: vi.fn(), createRequirementChange: vi.fn(), createPrototypeRequirementChange: vi.fn(), downloadRequirementChangePrototype: vi.fn(), restartRequirementChange: vi.fn() } }));

const change = (overrides: Partial<RequirementChange> = {}): RequirementChange => ({
  id: 'change-1', requirementId: 'req-1', revision: 1, content: '导出增加 Excel 格式', mode: 'SUPPLEMENT',
  createdByName: '产品甲', createdAt: '2026-10-23T08:00:00Z', sourceWorkflowRunId: null,
  restartWorkflowRunId: null, restartStatus: 'NOT_REQUESTED', errorMessage: null, ...overrides,
});
const snapshot = (changes: RequirementChange[] = [], overrides: Partial<RequirementChanges> = {}): RequirementChanges => ({ revision: changes[0]?.revision ?? 0, changes, ...overrides });

describe('需求变更最小闭环', () => {
  let container: HTMLDivElement, root: Root;
  const onChanged = vi.fn();
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    vi.mocked(api.getRequirementChanges).mockResolvedValue(snapshot());
    vi.mocked(api.createRequirementChange).mockResolvedValue(change());
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks(); vi.useRealTimers(); });
  async function render(requirementId = 'req-1', workflowRunId?: string) {
    await act(async () => { root.render(<MemoryRouter><RequirementChangesPanel requirementId={requirementId} workflowRunId={workflowRunId} onChanged={onChanged} /></MemoryRouter>); });
  }
  const button = (label: string) => Array.from(container.querySelectorAll('button')).find(node => node.textContent === label);
  async function click(label: string) { expect(button(label), label).toBeDefined(); await act(async () => { button(label)!.click(); }); }
  async function fill(content: string) {
    await act(async () => {
      const input = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, content);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('默认收起输入，只展示简洁入口；空内容不能提交', async () => {
    await render();
    expect(container.querySelector('textarea')).toBeNull();
    await click('需求变更');
    expect(button('提交变更')?.disabled).toBe(true);
    expect(button('重新走流程')?.disabled).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await fill('   ');
    expect(button('提交变更')?.disabled).toBe(true);
  });

  it('一句话直接提交正式变更，保留来源流程且无需确认', async () => {
    await render('req-1', 'run-1'); await click('需求变更'); await fill('  导出增加 Excel 格式  '); await click('提交变更');
    expect(api.createRequirementChange).toHaveBeenCalledWith('req-1', { content: '导出增加 Excel 格式', mode: 'SUPPLEMENT', sourceWorkflowRunId: 'run-1', requestId: expect.any(String) });
    expect(container.textContent).toContain('导出增加 Excel 格式');
    expect(container.textContent).toContain('产品甲');
    expect(onChanged).toHaveBeenCalledOnce();
    expect(container.querySelector('textarea')).toBeNull();
    expect(api.restartRequirementChange).not.toHaveBeenCalled();
  });

  it('提交失败保留原文及幂等键，允许直接重试', async () => {
    vi.mocked(api.createRequirementChange).mockRejectedValueOnce(new Error('网络暂时不可用')).mockResolvedValueOnce(change());
    await render(); await click('需求变更'); await fill('导出增加 Excel 格式'); await click('提交变更');
    expect(container.textContent).toContain('网络暂时不可用');
    expect(container.querySelector('textarea')?.value).toBe('导出增加 Excel 格式');
    const requestId = vi.mocked(api.createRequirementChange).mock.calls[0][1].requestId;
    await click('提交变更');
    expect(vi.mocked(api.createRequirementChange).mock.calls[1][1].requestId).toBe(requestId);
  });

  it('普通 HTTP 环境没有 randomUUID 时仍可提交并结束忙碌状态', async () => {
    const previousCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {});
    try {
      await render(); await click('需求变更'); await fill('HTTP 环境的变更'); await click('提交变更');
      expect(api.createRequirementChange).toHaveBeenCalledWith('req-1', expect.objectContaining({ requestId: expect.stringMatching(/.+/), content: 'HTTP 环境的变更' }));
      expect(button('需求变更')?.disabled).toBe(false);
    } finally { vi.stubGlobal('crypto', previousCrypto); }
  });

  it('首屏读取期间提交成功，自动补拉完整历史且不被迟到旧快照覆盖', async () => {
    let resolveFirst!: (value: RequirementChanges) => void;
    const newest = change({ id: 'new-change', revision: 2, content: '本次新变更' });
    vi.mocked(api.getRequirementChanges).mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValue(snapshot([newest, change()]));
    vi.mocked(api.createRequirementChange).mockResolvedValue(newest);
    await render(); await click('需求变更'); await fill('本次新变更'); await click('提交变更');
    await act(async () => { resolveFirst(snapshot([change()])); });
    expect(container.textContent).toContain('本次新变更');
    expect(container.textContent).toContain('导出增加 Excel 格式');
    expect(api.getRequirementChanges).toHaveBeenCalledTimes(2);
  });

  it('重新走流程提交成功后直接进入关联新流程', async () => {
    vi.mocked(api.createRequirementChange).mockResolvedValue(change({ mode: 'RESTART', restartStatus: 'STARTED', restartWorkflowRunId: 'run-next' }));
    await render('req-1', 'run-old'); await click('需求变更'); await fill('改为团队协同看板'); await click('重新走流程');
    expect(api.createRequirementChange).toHaveBeenCalledWith('req-1', expect.objectContaining({ mode: 'RESTART', content: '改为团队协同看板', sourceWorkflowRunId: 'run-old' }));
    expect(navigate).toHaveBeenCalledWith('/workflow-runs/run-next');
  });

  it('有活跃任务时显示已保存和待启动原因，并可重试原变更', async () => {
    const pending = change({ mode: 'RESTART', restartStatus: 'PENDING', errorMessage: '请先结束原工作流的活跃任务' });
    vi.mocked(api.getRequirementChanges).mockResolvedValue(snapshot([pending]));
    vi.mocked(api.restartRequirementChange).mockResolvedValue({ ...pending, restartStatus: 'STARTED', restartWorkflowRunId: 'run-next', errorMessage: null });
    await render();
    expect(container.textContent).toContain('待启动');
    expect(container.textContent).toContain('请先结束原工作流的活跃任务');
    await click('继续启动流程');
    expect(api.restartRequirementChange).toHaveBeenCalledWith('req-1', 'change-1');
    expect(api.createRequirementChange).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/workflow-runs/run-next');
  });

  it('显示当前任务未同步新变更，不能将记录成功说成任务已读取', async () => {
    vi.mocked(api.getRequirementChanges).mockResolvedValue(snapshot([change()], { contextRevision: 0, hasPendingChanges: true }));
    await render('req-1', 'run-1');
    expect(container.textContent).toContain('当前任务尚未读取最新变更');
    expect(container.textContent).toContain('重新领取');
    expect(api.getRequirementChanges).toHaveBeenCalledWith('req-1', 'run-1');
  });

  it('历史超过三条默认折叠，正式原文按修订展示', async () => {
    vi.mocked(api.getRequirementChanges).mockResolvedValue(snapshot([4, 3, 2, 1].map(revision => change({ id: `c-${revision}`, revision, content: `正式变更 ${revision}` }))));
    await render();
    expect(container.querySelectorAll('article')).toHaveLength(4);
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('details')?.textContent).toContain('正式变更 1');
  });

  it('补充变更历史明确展示方式与来源流程', async () => {
    vi.mocked(api.getRequirementChanges).mockResolvedValue(snapshot([change({ sourceWorkflowRunId: 'run-source' })]));
    await render();
    expect(container.textContent).toContain('补充变更');
    expect(container.querySelector('a[href="/workflow-runs/run-source"]')).toBeTruthy();
  });

  it('列表加载失败独立重试，不影响提交入口', async () => {
    vi.mocked(api.getRequirementChanges).mockRejectedValueOnce(new Error('记录加载失败')).mockResolvedValueOnce(snapshot([change()]));
    await render();
    expect(container.textContent).toContain('记录加载失败');
    await click('重新加载');
    expect(container.textContent).toContain('导出增加 Excel 格式');
  });

  it('切换需求后旧列表响应不能污染新需求，旧提交也不能跳转', async () => {
    let resolveOld!: (value: RequirementChange) => void;
    vi.mocked(api.createRequirementChange).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    await render(); await click('需求变更'); await fill('旧需求的变更');
    await act(async () => { button('重新走流程')!.click(); });
    await render('req-2');
    await act(async () => { resolveOld(change({ mode: 'RESTART', restartStatus: 'STARTED', restartWorkflowRunId: 'run-wrong' })); });
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('旧需求的变更');
  });

  it('选 ZIP 后只能重新走流程，说明可选，切换 AI 后直接提交且可移除文件', async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.createPrototypeRequirementChange).mockResolvedValue(change({ mode: 'RESTART', restartStatus: 'STARTING', prototype: { name: 'new.zip', aiProvider: 'cursor' } }));
    await render(); await click('需求变更');
    const file = new File(['zip'], 'new.zip');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(button('提交变更')?.disabled).toBe(true);
    expect(button('重新走流程')?.disabled).toBe(false);
    await act(async () => { container.querySelector('[aria-label="变更使用的 AI"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { (Array.from(document.querySelectorAll('[role="option"]')).find(item => item.textContent === 'Cursor CLI') as HTMLElement).click(); });
    await click('重新走流程');
    expect(api.createPrototypeRequirementChange).toHaveBeenCalledWith('req-1', expect.objectContaining({ mode: 'RESTART', content: '更新原型：new.zip', aiProvider: 'cursor', requestId: expect.any(String) }), file);
    expect(api.createRequirementChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain('new.zip');
  });
  it('无效 ZIP 阻止启动，撤销后恢复一句话变更；请求失败保留 ZIP 与幂等键', async () => {
    vi.mocked(api.createPrototypeRequirementChange).mockRejectedValue(new Error('网络中断'));
    await render(); await click('需求变更'); await fill('变更说明');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['bad'], 'bad.txt')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(button('重新走流程')?.disabled).toBe(true);
    await click('移除 ZIP');
    expect(button('提交变更')?.disabled).toBe(false);
    const nextInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['zip'], 'new.zip');
    Object.defineProperty(nextInput, 'files', { value: [file] });
    await act(async () => { nextInput.dispatchEvent(new Event('change', { bubbles: true })); });
    await click('重新走流程'); await click('重新走流程');
    expect(container.textContent).toContain('网络中断');
    expect(container.textContent).toContain('new.zip');
    const calls = vi.mocked(api.createPrototypeRequirementChange).mock.calls;
    expect(calls[0][1].requestId).toBe(calls[1][1].requestId);
  });
  it('后台启动轮询保留历史与输入，启动完成后停止且不重复请求', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getRequirementChanges).mockResolvedValue(snapshot([change({ mode: 'RESTART', restartStatus: 'STARTING' })]));
    await render(); await click('需求变更'); await fill('正在输入的下一条变更');
    vi.mocked(api.getRequirementChanges).mockResolvedValue(snapshot([change({ mode: 'RESTART', restartStatus: 'STARTED', restartWorkflowRunId: 'run-ready' })]));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(container.querySelector('textarea')?.value).toBe('正在输入的下一条变更');
    expect(container.textContent).toContain('导出增加 Excel 格式');
    const count = vi.mocked(api.getRequirementChanges).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(api.getRequirementChanges).toHaveBeenCalledTimes(count);
  });

  it('StrictMode 重放后仍能完成加载', async () => {
    vi.mocked(api.getRequirementChanges).mockResolvedValue(snapshot([change()]));
    await act(async () => { root.render(<StrictMode><MemoryRouter><RequirementChangesPanel requirementId="req-1" /></MemoryRouter></StrictMode>); });
    expect(container.textContent).toContain('导出增加 Excel 格式');
    expect(container.textContent).not.toContain('正在加载变更');
  });
});
