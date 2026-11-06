import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import type { TestCaseLibrary, TestCaseModule, TestRequest, TestRequestScopeDraft } from '../../types';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { ListPagination } from '../../components/ListPagination';

export function QualityScopeDraftPanel({ request, onConfirmed }: { request: TestRequest; onConfirmed: (next: TestRequest) => void }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<TestRequestScopeDraft>();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [libraries, setLibraries] = useState<TestCaseLibrary[]>([]);
  const [modules, setModules] = useState<TestCaseModule[]>([]);
  const [libraryId, setLibraryId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [savingCandidate, setSavingCandidate] = useState<string>();

  async function load({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true);
    try {
      const next = await api.getTestRequestScopeDraft(request.id, { page, pageSize: 50, q: query || undefined });
      setDraft(next);
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : '加载 AI 提测范围失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [request.id, page, query]);
  useEffect(() => {
    void api.getTestCaseLibraries({ workspaceId: request.workspaceId, projectId: request.projectId, page: 1, pageSize: 100 })
      .then(result => { setLibraries(result.items); setLibraryId(current => current || result.items[0]?.id || ''); })
      .catch(() => undefined);
  }, [request.workspaceId, request.projectId]);
  useEffect(() => {
    if (!libraryId) { setModules([]); setModuleId(''); return; }
    void api.getTestCaseModules(libraryId, { page: 1, pageSize: 100 })
      .then(result => { setModules(result.items); setModuleId(current => result.items.some(item => item.id === current) ? current : ''); })
      .catch(() => setModules([]));
  }, [libraryId]);
  useEffect(() => {
    if (!['GENERATING', 'NOT_STARTED'].includes(request.testDesign?.status ?? request.scopeGenerationStatus)) return;
    const timer = window.setInterval(() => void load({ silent: true }), 2000);
    return () => window.clearInterval(timer);
  }, [request.id, request.testDesign?.status, request.scopeGenerationStatus, page, query]);

  const candidates = draft?.items ?? [];
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof candidates>();
    for (const item of candidates) {
      const key = item.sourceDefinition?.module?.name ?? '未分模块';
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [candidates]);

  async function removeSelected(ids = selected) {
    if (!ids.length || !draft) return;
    setSaving(true);
    try {
      const next = await api.updateTestRequestScopeDraft(request.id, { scopeRevision: draft.scopeRevision, removedCandidateIds: ids });
      setSelected([]);
      setDraft(undefined);
      onConfirmed(next);
      await load();
      toast.success(`已从本次范围移除 ${ids.length} 条用例`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除范围用例失败');
    } finally { setSaving(false); }
  }

  async function confirmScope() {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await api.prepareTestRequest(request.id, { scopeRevision: draft.scopeRevision });
      onConfirmed(next);
      toast.success('范围已确认，请继续分派执行人');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '确认提测范围失败');
    } finally { setSaving(false); }
  }

  async function saveGeneratedCase(candidateId: string) {
    if (!libraryId) { toast.error('请先选择要保存的项目用例库'); return; }
    setSavingCandidate(candidateId);
    try {
      await api.saveGeneratedTestRequestCase(request.id, candidateId, { libraryId, ...(moduleId ? { moduleId } : {}) });
      setDraft(current => current ? { ...current, items: current.items.map(item => item.id === candidateId ? { ...item, sourceDefinitionId: 'saved' } : item) } : current);
      toast.success('AI 新用例已保存到用例库');
    } catch (error) { toast.error(error instanceof Error ? error.message : '保存 AI 新用例失败'); }
    finally { setSavingCandidate(undefined); }
  }

  const analyzing = request.testDesign?.status === 'GENERATING' || request.scopeGenerationStatus === 'GENERATING';
  return (
    <section className="space-y-4 rounded-md border p-4" aria-label="AI 提测范围">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">AI 提测范围</h2>
          <p className="mt-1 text-sm text-muted-foreground">AI 已默认纳入候选；不满意的库、模块或用例直接删掉即可。</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">共 {draft?.total ?? 0} 条</Badge>
          <Button size="sm" disabled={saving || loading || analyzing || !draft?.total} onClick={() => void confirmScope()}>确认范围并进入分派</Button>
        </div>
      </div>
      {analyzing ? <p role="status" className="rounded-md bg-muted/40 p-3 text-sm">AI 正在读取需求、方案和代码变更并生成范围…</p> : null}
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-sm" placeholder="搜索用例标题" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} aria-label="搜索 AI 提测用例" />
        <Button variant="outline" size="sm" disabled={!selected.length || saving} onClick={() => void removeSelected()}>移除已选 {selected.length ? `(${selected.length})` : ''}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 p-3 text-sm">
        <span className="text-muted-foreground">保存 AI 新用例到长期用例库（可选）：</span>
        <select className="rounded border bg-background px-2 py-1" aria-label="保存目标用例库" value={libraryId} onChange={event => setLibraryId(event.target.value)}>
          <option value="">选择用例库</option>
          {libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}
        </select>
        <select className="rounded border bg-background px-2 py-1" aria-label="保存目标用例模块" value={moduleId} onChange={event => setModuleId(event.target.value)} disabled={!libraryId}>
          <option value="">不指定模块</option>
          {modules.map(module => <option key={module.id} value={module.id}>{module.name}</option>)}
        </select>
      </div>
      {loading ? <p role="status" className="text-sm text-muted-foreground">范围加载中…</p> : null}
      {!loading && !candidates.length ? <p className="text-sm text-muted-foreground">当前没有可纳入的 AI 用例。</p> : null}
      <div className="space-y-4">
        {grouped.map(([module, items]) => (
          <div key={module} className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-medium">{module}</h3><span className="text-xs text-muted-foreground">{items.length} 条</span></div>
            <div className="space-y-1">
              {items.map(item => (
                <label key={item.id} className="flex items-start gap-2 rounded px-2 py-2 text-sm hover:bg-muted/40">
                  <input type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
                  <span className="min-w-0 flex-1"><span className="font-medium">{item.proposedCase.title}</span><span className="ml-2 text-xs text-muted-foreground">{item.action === 'CREATE' ? 'AI 新用例' : item.action === 'OPTIMIZE' ? '建议优化' : '已有用例'}</span><span className="mt-1 block text-xs text-muted-foreground">{item.proposedCase.steps.length} 步 · {item.proposedCase.priority} · {item.matchReason ?? 'AI 根据本次变更纳入'}</span></span>
                  {item.action === 'CREATE' ? <Button type="button" variant="ghost" size="sm" disabled={Boolean(item.sourceDefinitionId) || savingCandidate === item.id} onClick={() => void saveGeneratedCase(item.id)}>{item.sourceDefinitionId ? '已保存' : savingCandidate === item.id ? '保存中…' : '保存到用例库'}</Button> : null}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {draft ? <ListPagination page={draft.page} total={draft.total} pageSize={draft.pageSize} onPageChange={setPage} /> : null}
    </section>
  );
}
