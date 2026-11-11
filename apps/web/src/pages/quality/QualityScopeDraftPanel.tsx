import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { TestDesignCandidate, TestRequest, TestRequestScopeDraft } from '../../types';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import { QualityScopeDirectory, type ScopeDirectorySelection } from './QualityScopeDirectory';
import { QualityScopeCaseDetails } from './QualityScopeCaseDetails';
import { QualityScopeModuleOverview, type ScopeModuleBatchAction } from './QualityScopeModuleOverview';

// 保存队列跨页签卸载继续完成；重新进入同一提测时，首读等待旧实例排空。
const scopeWrites = new Map<string, { owner: symbol; promise: Promise<void> }>();

type Override = { item: TestDesignCandidate; included: boolean; wasIncluded: boolean };
const included = (item: TestDesignCandidate) => item.action !== 'EXCLUDE' && item.resolution !== 'REJECTED';
const itemKey = (item: TestDesignCandidate) => item.sourceDefinitionId ? `case:${item.sourceDefinitionId}` : item.id;
const message = (reason: unknown) => reason instanceof Error ? reason.message : '操作失败，请重新同步后重试';

export function QualityScopeDraftPanel({ request, onConfirmed }: { request: TestRequest; onConfirmed: (next: TestRequest) => void }) {
  const [draft, setDraft] = useState<TestRequestScopeDraft>();
  const [directory, setDirectory] = useState<ScopeDirectorySelection>({ label: '全部目录' });
  const [view, setView] = useState<'exceptions' | 'library'>('exceptions');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [undo, setUndo] = useState<TestDesignCandidate>();
  const [detail, setDetail] = useState<TestDesignCandidate>();
  const [confirming, setConfirming] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const revision = useRef(0);
  const queued = useRef(0);
  const queue = useRef(Promise.resolve());
  const owner = useRef(Symbol('scope-workbench'));
  const failed = useRef(false);
  const epoch = useRef(0);
  const alive = useRef(true);
  const latestQuery = useRef({ view, q: query.trim() || undefined, page, pageSize: 20, libraryId: directory.libraryId, moduleId: directory.moduleId });
  latestQuery.current = { view, q: query.trim() || undefined, page, pageSize: 20, libraryId: directory.libraryId, moduleId: directory.moduleId };
  const liveOverrides = useRef(overrides);
  const loadDraft = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const version = ++epoch.current;
    if (!silent) setLoading(true);
    try {
      let previous = scopeWrites.get(request.id);
      while (previous && previous.owner !== owner.current) {
        await previous.promise;
        previous = scopeWrites.get(request.id);
      }
      if (!alive.current || version !== epoch.current) return 'stale' as const;
      const result = await api.getTestRequestScopeDraft(request.id, latestQuery.current);
      // 写入开始后，旧查询不能覆盖用户已经做出的选择。
      if (!alive.current || version !== epoch.current || queued.current) return 'stale' as const;
      revision.current = result.scopeRevision;
      setDraft(result);
      if (result.totalPages > 0 && latestQuery.current.page > result.totalPages) setPage(result.totalPages);
      liveOverrides.current = {}; setOverrides({});
      return 'synced' as const;
    } catch (reason) {
      if (!alive.current || version !== epoch.current || queued.current) return 'stale' as const;
      setError(message(reason));
      return 'failed' as const;
    } finally {
      if (alive.current && version === epoch.current) setLoading(false);
    }
  }, [request.id]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; ++epoch.current; }; }, []);
  useEffect(() => {
    setLoading(true);
    if (!queued.current) void loadDraft();
    return () => { ++epoch.current; };
  }, [loadDraft, view, query, directory.libraryId, directory.moduleId, page]);

  const status = draft?.designStatus ?? request.testDesign?.status ?? draft?.status ?? request.scopeGenerationStatus;
  const analyzing = status === 'GENERATING' || (status === 'NOT_STARTED' && !draft?.items.length);
  useEffect(() => {
    if (!analyzing) return;
    let cancelled = false;
    let timer: number;
    async function poll() {
      if (!queued.current && !failed.current) await loadDraft({ silent: true });
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2000);
    }
    timer = window.setTimeout(() => void poll(), 2000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [analyzing, loadDraft]);

  function enqueue(write: (scopeRevision: number) => Promise<TestRequest>, optimistic?: Override, removed?: TestDesignCandidate) {
    if (failed.current || confirming || savingDetail) return;
    ++epoch.current;
    ++queued.current;
    setLoading(false);
    setPending(queued.current);
    if (optimistic) {
      const next = { ...liveOverrides.current, [itemKey(optimistic.item)]: optimistic };
      liveOverrides.current = next; setOverrides(next);
    }
    if (removed) setUndo(removed);
    queue.current = queue.current.then(async () => {
      if (failed.current) return;
      try {
        const result = await write(revision.current);
        revision.current = result.scopeRevision;
      } catch (reason) {
        failed.current = true;
        if (alive.current) { setError(message(reason)); setUndo(undefined); }
      }
    }).finally(async () => {
      --queued.current;
      if (!alive.current) return;
      // 所有连续操作结束后统一重读，避免中途响应把后续操作回滚。
      if (!queued.current) {
        const synced = await loadDraft({ silent: true });
        if (!alive.current) return;
        if (synced === 'failed' && failed.current) { liveOverrides.current = {}; setOverrides({}); }
        if (synced === 'failed' && !failed.current) { failed.current = true; setError('修改已提交，但刷新失败，请重新同步'); }
      }
      setPending(queued.current);
    });
    const tail = queue.current;
    scopeWrites.set(request.id, { owner: owner.current, promise: tail });
    void tail.then(() => { if (scopeWrites.get(request.id)?.promise === tail) scopeWrites.delete(request.id); });
  }

  function toggle(item: TestDesignCandidate, selected: boolean) {
    const override = { item, included: selected, wasIncluded: included(item) };
    if (!selected) {
      enqueue(scopeRevision => api.updateTestRequestScopeDraft(request.id, { scopeRevision, removedCandidateIds: [item.id] }), override, item);
    } else if (item.id.startsWith('library:')) {
      enqueue(scopeRevision => api.addTestRequestScopeDraftCases(request.id, { scopeRevision, selections: [{ caseId: item.sourceDefinitionId!, reason: '人工补充提测范围', impactLevel: 'MEDIUM' }] }), override);
    } else {
      enqueue(scopeRevision => api.updateTestRequestScopeDraft(request.id, { scopeRevision, removedCandidateIds: [], restoredCandidateIds: [item.id] }), override);
    }
  }

  async function resync() {
    if (await loadDraft({ silent: Boolean(draft) }) === 'synced') {
      failed.current = false; setError(''); liveOverrides.current = {}; setOverrides({}); setUndo(undefined);
    }
  }
  async function confirm() {
    if (pending || !draft || error) return;
    setConfirming(true);
    try { onConfirmed(await api.prepareTestRequest(request.id, { scopeRevision: revision.current })); }
    catch (reason) { failed.current = true; setError(message(reason)); }
    finally { if (alive.current) setConfirming(false); }
  }

  const rows = [...(draft?.items ?? [])];
  for (const change of Object.values(overrides)) {
    const index = rows.findIndex(item => itemKey(item) === itemKey(change.item));
    const next = { ...change.item, action: change.item.action === 'EXCLUDE' ? 'REUSE' as const : change.item.action, resolution: change.included ? 'ACCEPTED' as const : 'REJECTED' as const, decisionNote: change.included ? '恢复到本次提测范围' : '从本次提测范围移除', exceptionReason: null };
    if (index >= 0) rows[index] = next;
    else if (change.included && (view === 'library' || view === 'exceptions')) rows.push(next);
  }
  const visible = view === 'exceptions' ? rows.filter(item => item.exceptionReason || (item.action === 'CREATE' && !item.sourceDefinitionId) || (item.resolution === 'PENDING' && !item.decisionNote) || (item.action === 'EXCLUDE' && !item.decisionNote)) : rows;
  const selectedCount = Math.max(0, (draft?.summary?.included ?? draft?.items.filter(included).length ?? 0) + Object.values(overrides).reduce((sum, change) => sum + Number(change.included) - Number(change.wasIncluded), 0));
  const detailIndex = detail ? visible.findIndex(item => item.id === detail.id || itemKey(item) === itemKey(detail)) : -1;
  const currentDetail = detailIndex >= 0 ? visible[detailIndex] : detail;
  const totalPages = draft?.totalPages ?? 0;
  const confirmed = Boolean((request.testPlan?._count?.snapshots ?? request.testPlan?.snapshots.length ?? 0) > 0);
  const locked = confirmed || Boolean(error) || confirming || savingDetail || analyzing;

  const coverageChanges = new Set(rows.flatMap(item => item.coverageKeys ?? [])).size;
  const moduleSummary = directory.summary;
  const exceptionLabel: Record<string, string> = { AI_NEW_CASE: 'AI 新用例', PENDING_REVIEW: '待审阅', AI_EXCLUDED: 'AI 排除' };
  function batchModule(action: ScopeModuleBatchAction) {
    if (!directory.moduleId) return;
    setUndo(undefined);
    enqueue(scopeRevision => api.updateTestRequestScopeModule(request.id, { scopeRevision, moduleId: directory.moduleId!, included: action.included, ...(action.strategy ? { strategy: action.strategy } : {}) }));
  }

  return <section className="space-y-3 rounded-md border p-4" aria-label="AI 提测范围">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">提测范围</h2>
      <span role="status" className={cn('text-xs text-muted-foreground', error && 'text-destructive')}>{pending || confirming || savingDetail ? '保存中…' : error ? '同步失败' : draft ? '已保存' : '加载中…'}</span>
    </div>
    {analyzing ? <p role="status" className="rounded bg-muted/40 p-3 text-sm">AI 正在根据需求和代码变更生成第一版范围…</p> : null}
    {confirmed ? <p role="status" className="rounded border border-primary/20 bg-primary/5 p-3 text-sm">范围已确认，仅可查看。需要调整时请新建回归提测。</p> : null}
    {status === 'GENERATION_FAILED' ? <p role="alert" className="rounded border border-destructive/30 p-3 text-sm text-destructive">AI 范围生成失败，请检查测试设计后重新分析。</p> : null}
    {error ? <div role="alert" className="flex items-center justify-between gap-2 rounded border border-destructive/30 p-2 text-sm text-destructive"><span>{error}</span><Button type="button" size="sm" variant="outline" disabled={Boolean(pending)} onClick={() => void resync()}>重新同步</Button></div> : null}
    <div className="grid gap-2 sm:grid-cols-4" aria-label="范围摘要">
      {[
        ['预计提测', draft?.summary?.included],
        ['AI 推荐', draft?.summary?.aiRecommended],
        ['待处理例外', draft?.summary?.exceptionCount],
        ['覆盖变更点', coverageChanges || undefined],
      ].map(([label, value]) => <div key={label} className="rounded-md border bg-muted/20 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value ?? '—'}</p></div>)}
    </div>
    <div className={cn('grid items-start gap-3 lg:grid-cols-[220px_minmax(0,1fr)]', detail && 'xl:grid-cols-[200px_minmax(300px,1fr)_minmax(280px,360px)]')}>
      <QualityScopeDirectory request={request} selection={directory} onSelect={next => { setDirectory(next); setPage(1); setDetail(undefined); }} />
      <div className="min-w-0 rounded-md border">
        <div className="space-y-3 border-b p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="范围视图" className="flex rounded-md bg-muted/50 p-1">
              {([['exceptions', '只显示例外'], ['library', '全部用例']] as const).map(([value, label]) => <Button key={value} type="button" size="sm" variant={view === value ? 'secondary' : 'ghost'} aria-pressed={view === value} onClick={() => { setView(value); setPage(1); setDetail(undefined); }}>{label}</Button>)}
            </div>
            <span className="text-xs text-muted-foreground">{directory.label}</span>
          </div>
          <Input aria-label="搜索用例" placeholder="搜索用例标题" value={query} onChange={event => { setQuery(event.target.value); setPage(1); setDetail(undefined); }} />
          {directory.moduleId && moduleSummary ? <QualityScopeModuleOverview summary={moduleSummary} disabled={locked || Boolean(pending) || loading} pending={Boolean(pending)} onBatch={batchModule} /> : directory.moduleId ? <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>已选 {draft?.summary?.matchingIncluded ?? 0} / {draft?.summary?.available ?? 0} 条（含子模块）</span><Button type="button" variant="ghost" size="sm" disabled={locked || Boolean(pending) || loading} onClick={() => batchModule({ included: true, strategy: 'AI_RECOMMENDED' })}>纳入 AI 推荐</Button><Button type="button" variant="ghost" size="sm" disabled={locked || Boolean(pending) || loading} onClick={() => batchModule({ included: false })}>移除全部</Button></div> : null}
        </div>
        <div className="max-h-[440px] min-h-[300px] overflow-y-auto p-2" aria-busy={loading}>
          {loading ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">用例加载中…</p> : visible.map(item => <div key={itemKey(item)} className="flex items-center gap-3 rounded px-2 py-3 hover:bg-muted/40">
            <input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" aria-label={`选择范围用例 ${item.proposedCase.title}`} checked={included(item)} disabled={locked || Boolean(overrides[itemKey(item)])} onChange={event => toggle(item, event.target.checked)} />
            <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:text-primary hover:underline" aria-label={`查看用例 ${item.proposedCase.title}`} onClick={() => setDetail(item)}>{item.proposedCase.title}</button>
            <span className="hidden max-w-28 truncate text-xs text-muted-foreground md:inline">{item.sourceDefinition?.module?.name}</span>
            <span className="text-xs text-muted-foreground">{item.proposedCase.priority}</span>
            {item.exceptionReason ? <Badge variant="secondary">{exceptionLabel[item.exceptionReason] ?? item.exceptionReason}</Badge> : item.action === 'CREATE' && !item.sourceDefinitionId ? <Badge variant="secondary">AI 新用例</Badge> : null}
          </div>)}
          {!loading && !visible.length ? <div className="py-14 text-center text-sm text-muted-foreground"><p>{view === 'exceptions' ? '当前没有待处理例外' : '暂无匹配用例'}</p>{view === 'exceptions' ? <Button type="button" variant="ghost" size="sm" onClick={() => { setView('library'); setPage(1); }}>查看全部用例</Button> : null}</div> : null}
        </div>
        {totalPages > 1 ? <div className="flex items-center justify-end gap-3 border-t p-2 text-xs text-muted-foreground">
          <Button type="button" variant="ghost" size="sm" disabled={loading || page <= 1} onClick={() => { setPage(p => p - 1); setDetail(undefined); }}>上一页</Button>
          <span>第 {page} / {totalPages} 页</span>
          <Button type="button" variant="ghost" size="sm" disabled={loading || page >= totalPages} onClick={() => { setPage(p => p + 1); setDetail(undefined); }}>下一页</Button>
        </div> : null}
      </div>
      {currentDetail ? <QualityScopeCaseDetails key={currentDetail.id} request={request} item={currentDetail} previous={detailIndex > 0 ? visible[detailIndex - 1] : undefined} next={detailIndex >= 0 ? visible[detailIndex + 1] : undefined} onBusyChange={setSavingDetail} onNavigate={setDetail} onClose={() => setDetail(undefined)} disabled={Boolean(pending) || locked} onSaved={async () => { await loadDraft({ silent: true }); }} /> : null}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
      <div className="flex min-w-0 items-center gap-3"><span className="shrink-0">已选 {selectedCount} 条</span>{undo ? <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"><span className="max-w-48 truncate">已移除「{undo.proposedCase.title}」</span><Button type="button" variant="ghost" size="sm" disabled={Boolean(pending) || locked} onClick={() => { toggle({ ...undo, resolution: 'REJECTED' }, true); setUndo(undefined); }}>撤销</Button></span> : null}</div>
      <Button type="button" disabled={Boolean(pending) || locked || loading || !draft || selectedCount === 0} onClick={() => void confirm()}>确认范围并进入分派</Button>
    </div>
  </section>;
}
