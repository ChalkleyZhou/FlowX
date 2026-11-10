import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderTree, Library, Save, X } from 'lucide-react';
import { api } from '../../api';
import type { TestCaseDefinition, TestCaseLibrary, TestCaseModule, TestDesignCandidate, TestRequest, TestRequestScopeDraft } from '../../types';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';

type ViewFilter = 'ALL' | 'SELECTED' | 'AI';

type ScopeCase = {
  key: string;
  title: string;
  priority?: string;
  libraryId?: string;
  libraryName?: string;
  moduleId?: string | null;
  moduleName?: string | null;
  candidateId?: string;
  caseId?: string;
  action?: TestDesignCandidate['action'];
  saved?: boolean;
  isAiRecommended: boolean;
  precondition?: string | null;
  testData?: string | null;
  steps: string[];
  expected: string;
  tags?: string[];
};

function TreeToggle({ expanded, label, onClick }: { expanded: boolean; label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      aria-label={`${expanded ? '收起' : '展开'}${label}`}
      onClick={onClick}
    >
      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </Button>
  );
}

function NodeCheckbox({
  label,
  checked,
  onChange,
  prefix = '选择',
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  prefix?: string;
}) {
  return <input type="checkbox" aria-label={`${prefix} ${label}`} checked={checked} onChange={event => onChange(event.target.checked)} />;
}

export function QualityScopeDraftPanel({ request, onConfirmed }: { request: TestRequest; onConfirmed: (next: TestRequest) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<TestRequestScopeDraft>();
  const [libraries, setLibraries] = useState<TestCaseLibrary[]>([]);
  const [modulesByLibrary, setModulesByLibrary] = useState<Record<string, TestCaseModule[]>>({});
  const [casesByModule, setCasesByModule] = useState<Record<string, TestCaseDefinition[]>>({});
  const [expandedLibraries, setExpandedLibraries] = useState<string[]>([]);
  const [expandedModules, setExpandedModules] = useState<string[]>([]);
  const [activeLibraryId, setActiveLibraryId] = useState<string>();
  const [activeModuleId, setActiveModuleId] = useState<string>();
  const [selectedCaseKeys, setSelectedCaseKeys] = useState<string[]>([]);
  const [manuallyAddedCaseIds, setManuallyAddedCaseIds] = useState<string[]>([]);
  const [treeQuery, setTreeQuery] = useState('');
  const [query, setQuery] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('ALL');
  const [selectedCase, setSelectedCase] = useState<ScopeCase>();
  const [loading, setLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingCandidate, setSavingCandidate] = useState<string>();
  const [saveLibraryId, setSaveLibraryId] = useState('');
  const [saveModuleId, setSaveModuleId] = useState('');

  async function loadDraft({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true);
    try {
      setDraft(await api.getTestRequestScopeDraft(request.id, { page: 1, pageSize: 100 }));
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : '加载 AI 提测范围失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadDraft();
  }, [request.id]);

  useEffect(() => {
    if (!draft) return;
    setSelectedCaseKeys(draft.items.filter(item => item.action !== 'EXCLUDE').map(item => candidateKey(item)));
  }, [draft]);

  useEffect(() => {
    void api
      .getTestCaseLibraries({ workspaceId: request.workspaceId, projectId: request.projectId, page: 1, pageSize: 100 })
      .then(result => {
        setLibraries(result.items);
        setSaveLibraryId(current => current || result.items[0]?.id || '');
      })
      .catch(() => toast.error('加载用例库失败'));
  }, [request.workspaceId, request.projectId]);

  useEffect(() => {
    if (!['GENERATING', 'NOT_STARTED'].includes(request.testDesign?.status ?? request.scopeGenerationStatus)) return;
    const timer = window.setInterval(() => void loadDraft({ silent: true }), 2000);
    return () => window.clearInterval(timer);
  }, [request.id, request.testDesign?.status, request.scopeGenerationStatus]);

  function candidateKey(item: TestDesignCandidate) {
    return item.sourceDefinitionId ? `case:${item.sourceDefinitionId}` : `candidate:${item.id}`;
  }

  async function expandLibrary(libraryId: string) {
    setExpandedLibraries(current => (current.includes(libraryId) ? current.filter(id => id !== libraryId) : [...current, libraryId]));
    if (modulesByLibrary[libraryId]) return;
    setTreeLoading(true);
    try {
      const result = await api.getTestCaseModules(libraryId, { page: 1, pageSize: 100 });
      setModulesByLibrary(current => ({ ...current, [libraryId]: result.items }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载用例模块失败');
    } finally {
      setTreeLoading(false);
    }
  }

  async function expandModule(module: TestCaseModule) {
    setActiveLibraryId(module.libraryId);
    setActiveModuleId(module.id);
    setExpandedModules(current => (current.includes(module.id) ? current.filter(id => id !== module.id) : [...current, module.id]));
    if (casesByModule[module.id]) return;
    setTreeLoading(true);
    try {
      const result = await api.getTestCasesPage({
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        libraryId: module.libraryId,
        moduleId: module.id,
        page: 1,
        pageSize: 100,
      });
      setCasesByModule(current => ({ ...current, [module.id]: result.items }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载模块用例失败');
    } finally {
      setTreeLoading(false);
    }
  }

  function selectLibrary(libraryId: string) {
    setActiveLibraryId(libraryId);
    setActiveModuleId(undefined);
  }

  const candidates = useMemo(() => (draft?.items ?? []).filter(item => item.action !== 'EXCLUDE'), [draft]);
  const candidateByCaseId = useMemo(
    () => new Map(candidates.flatMap(item => (item.sourceDefinitionId ? [[item.sourceDefinitionId, item] as const] : []))),
    [candidates],
  );
  const scopeCases = useMemo<ScopeCase[]>(() => {
    const fromCandidates = candidates.map(item => {
      const source = item.sourceDefinition;
      const isGenerated = !item.sourceDefinitionId;
      return {
        key: candidateKey(item),
        title: item.proposedCase.title,
        priority: item.proposedCase.priority,
        libraryId: source?.libraryId,
        libraryName: source?.library?.name,
        moduleId: source?.moduleId,
        moduleName: source?.module?.name,
        candidateId: item.id,
        caseId: item.sourceDefinitionId ?? undefined,
        action: item.action,
        saved: Boolean(item.sourceDefinitionId),
        isAiRecommended: isGenerated || !manuallyAddedCaseIds.includes(item.sourceDefinitionId ?? ''),
        precondition: item.proposedCase.precondition,
        testData: item.proposedCase.testData,
        steps: item.proposedCase.steps,
        expected: item.proposedCase.expected,
        tags: item.proposedCase.tags,
      };
    });
    const loadedCases = Object.values(casesByModule).flatMap(items => items);
    const extraCases = loadedCases
      .filter(item => !candidateByCaseId.has(item.id))
      .map(item => ({
        key: `case:${item.id}`,
        title: item.title,
        priority: item.priority,
        libraryId: item.libraryId,
        libraryName: item.library?.name ?? libraries.find(library => library.id === item.libraryId)?.name,
        moduleId: item.moduleId,
        moduleName: item.module?.name ?? modulesByLibrary[item.libraryId]?.find(module => module.id === item.moduleId)?.name,
        caseId: item.id,
        saved: true,
        isAiRecommended: false,
        precondition: item.precondition,
        testData: item.testData,
        steps: item.steps,
        expected: item.expected,
        tags: item.tags ?? undefined,
      }));
    return [...fromCandidates, ...extraCases];
  }, [candidates, casesByModule, candidateByCaseId, libraries, modulesByLibrary, manuallyAddedCaseIds]);

  const visibleCases = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedTreeQuery = treeQuery.trim().toLowerCase();
    return scopeCases.filter(item => {
      if (activeModuleId && item.moduleId !== activeModuleId) return false;
      if (!activeModuleId && activeLibraryId && item.libraryId !== activeLibraryId) return false;
      if (normalizedQuery && ![item.title, item.moduleName, item.libraryName].filter(Boolean).some(value => value!.toLowerCase().includes(normalizedQuery))) return false;
      if (viewFilter === 'SELECTED' && !selectedCaseKeys.includes(item.key)) return false;
      if (viewFilter === 'AI' && !item.isAiRecommended) return false;
      if (normalizedTreeQuery && ![item.title, item.moduleName, item.libraryName].filter(Boolean).some(value => value!.toLowerCase().includes(normalizedTreeQuery))) return false;
      return true;
    });
  }, [scopeCases, activeLibraryId, activeModuleId, query, treeQuery, viewFilter, selectedCaseKeys]);

  const filteredLibraries = useMemo(
    () => libraries.filter(library => !treeQuery.trim() || library.name.toLowerCase().includes(treeQuery.trim().toLowerCase()) || (modulesByLibrary[library.id] ?? []).some(module => module.name.toLowerCase().includes(treeQuery.trim().toLowerCase()))),
    [libraries, treeQuery, modulesByLibrary],
  );

  function isSelected(item: ScopeCase) {
    return selectedCaseKeys.includes(item.key);
  }

  async function addCases(caseIds: string[]) {
    const ids = [...new Set(caseIds)].filter(id => !selectedCaseKeys.includes(`case:${id}`));
    if (!ids.length) return;
    setSelectedCaseKeys(current => [...new Set([...current, ...ids.map(id => `case:${id}`)])]);
    setManuallyAddedCaseIds(current => [...new Set([...current, ...ids])]);
    setSaving(true);
    try {
      await api.addTestRequestScopeDraftCases(request.id, {
        selections: ids.map(caseId => ({ caseId, reason: '人工补充提测范围', impactLevel: 'MEDIUM' as const })),
      });
      await loadDraft();
      toast.success(`已加入 ${ids.length} 条用例`);
    } catch (error) {
      setSelectedCaseKeys(current => current.filter(key => !ids.includes(key.slice(5))));
      toast.error(error instanceof Error ? error.message : '加入提测范围失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeCandidates(candidateIds: string[]) {
    if (!draft || !candidateIds.length) return;
    setSelectedCaseKeys(current => current.filter(key => !candidateIds.some(id => key === `candidate:${id}` || key === `case:${candidates.find(item => item.id === id)?.sourceDefinitionId}`)));
    setSaving(true);
    try {
      await api.updateTestRequestScopeDraft(request.id, { scopeRevision: draft.scopeRevision, removedCandidateIds: candidateIds });
      await loadDraft();
      toast.success(`已移出 ${candidateIds.length} 条用例`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移出提测范围失败');
    } finally {
      setSaving(false);
    }
  }

  async function toggleItem(item: ScopeCase, checked: boolean) {
    if (checked) {
      if (item.caseId) await addCases([item.caseId]);
      return;
    }
    if (item.candidateId) await removeCandidates([item.candidateId]);
  }

  async function toggleTreeRows(rows: ScopeCase[], checked: boolean) {
    if (checked) {
      await addCases(rows.filter(item => item.caseId && !isSelected(item)).map(item => item.caseId!));
    } else {
      await removeCandidates(rows.filter(item => isSelected(item) && item.candidateId).map(item => item.candidateId!));
    }
  }

  async function toggleLibrarySelection(library: TestCaseLibrary, checked: boolean) {
    const rows = scopeCases.filter(item => item.libraryId === library.id);
    await toggleTreeRows(rows, checked);
  }

  async function toggleModuleSelection(module: TestCaseModule, checked: boolean) {
    const rows = scopeCases.filter(item => item.moduleId === module.id);
    await toggleTreeRows(rows, checked);
  }

  async function saveGeneratedCase(candidateId: string) {
    if (!saveLibraryId) {
      toast.error('请先选择保存目标用例库');
      return;
    }
    setSavingCandidate(candidateId);
    try {
      const result = await api.saveGeneratedTestRequestCase(request.id, candidateId, { libraryId: saveLibraryId, ...(saveModuleId ? { moduleId: saveModuleId } : {}) });
      setDraft(current => current ? { ...current, items: current.items.map(item => item.id === candidateId ? { ...item, sourceDefinitionId: result.testCase.id } : item) } : current);
      setSelectedCaseKeys(current => current.map(key => key === `candidate:${candidateId}` ? `case:${result.testCase.id}` : key));
      toast.success('AI 新用例已保存到用例库');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 AI 新用例失败');
    } finally {
      setSavingCandidate(undefined);
    }
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
    } finally {
      setSaving(false);
    }
  }

  function renderModule(module: TestCaseModule) {
    const rows = scopeCases.filter(item => item.moduleId === module.id);
    const selected = rows.length > 0 && rows.every(item => isSelected(item));
    const visible = !treeQuery.trim() || module.name.toLowerCase().includes(treeQuery.trim().toLowerCase()) || rows.some(item => item.title.toLowerCase().includes(treeQuery.trim().toLowerCase()));
    if (!visible) return null;
    return (
      <div key={module.id} className="space-y-1">
        <div className="flex items-center gap-1 rounded px-1 py-1 hover:bg-muted/40">
          <NodeCheckbox label={module.name} prefix="选择模块" checked={selected} onChange={checked => void toggleModuleSelection(module, checked)} />
          <TreeToggle expanded={expandedModules.includes(module.id)} label={`模块 ${module.name}`} onClick={() => void expandModule(module)} />
          <FolderTree className="h-4 w-4 text-muted-foreground" />
          <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:underline" onClick={() => { setActiveLibraryId(module.libraryId); setActiveModuleId(module.id); }} aria-label={`筛选模块 ${module.name}`}>{module.name}</button>
          <span className="text-xs text-muted-foreground">{module._count?.cases ?? rows.length}</span>
        </div>
        {expandedModules.includes(module.id) ? (
          <div className="ml-5 space-y-1">
            {(casesByModule[module.id] ?? []).map(item => {
              const row = scopeCases.find(scopeCase => scopeCase.key === `case:${item.id}`);
              if (!row) return null;
              return (
                <label key={item.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/40">
                  <NodeCheckbox label={item.title} prefix="选择用例" checked={isSelected(row)} onChange={checked => void toggleItem(row, checked)} />
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setSelectedCase(row)} aria-label={`查看用例 ${item.title}`}>{item.title}</button>
                  <span className="text-xs text-muted-foreground">{item.priority}</span>
                </label>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  function renderLibrary(library: TestCaseLibrary) {
    const modules = (modulesByLibrary[library.id] ?? []).filter(module => !module.parentId);
    const rows = scopeCases.filter(item => item.libraryId === library.id);
    const selected = rows.length > 0 && rows.every(item => isSelected(item));
    return (
      <div key={library.id} className="space-y-1">
        <div className="flex items-center gap-1 rounded px-1 py-1 hover:bg-muted/40">
          <NodeCheckbox label={library.name} prefix="选择用例库" checked={selected} onChange={checked => void toggleLibrarySelection(library, checked)} />
          <TreeToggle expanded={expandedLibraries.includes(library.id)} label={`用例库 ${library.name}`} onClick={() => void expandLibrary(library.id)} />
          <Library className="h-4 w-4 text-muted-foreground" />
          <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" onClick={() => selectLibrary(library.id)} aria-label={`筛选用例库 ${library.name}`}>{library.name}</button>
          <Badge variant="outline">{library.scope === 'WORKSPACE' ? '共享' : '项目'}</Badge>
        </div>
        {expandedLibraries.includes(library.id) ? <div className="ml-4 space-y-1">{modules.map(renderModule)}</div> : null}
      </div>
    );
  }

  const analyzing = request.testDesign?.status === 'GENERATING' || request.scopeGenerationStatus === 'GENERATING';
  const selectedCount = scopeCases.filter(isSelected).length;
  const removedCount = draft ? (draft.summary?.EXCLUDE ?? 0) + (draft.summary?.REJECTED ?? 0) : 0;

  return (
    <section className="space-y-4 rounded-md border p-4" aria-label="AI 提测范围">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">AI 提测范围</h2>
          <p className="mt-1 text-sm text-muted-foreground">从左侧用例树定位范围，右侧列表勾选即加入；AI 推荐已默认勾选。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">已选 {selectedCount}</Badge>
          <Badge variant="outline">AI 推荐 {scopeCases.filter(item => item.isAiRecommended).length}</Badge>
          <Badge variant="outline">已移除 {removedCount}</Badge>
        </div>
      </div>

      {analyzing ? <p role="status" className="rounded-md bg-muted/40 p-3 text-sm">AI 正在读取需求、方案和代码变更并生成范围…</p> : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(180px,260px)_minmax(0,1fr)]">
        <aside className="min-h-[360px] rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-medium">用例目录</h3>
            <span className="text-xs text-muted-foreground">{libraries.length} 个库</span>
          </div>
          <Input aria-label="搜索用例库或模块" placeholder="搜索用例库或模块" value={treeQuery} onChange={event => setTreeQuery(event.target.value)} />
          {treeLoading ? <p className="mt-2 text-xs text-muted-foreground">树节点加载中…</p> : null}
          <div className="mt-3 space-y-1">{filteredLibraries.map(renderLibrary)}{!filteredLibraries.length ? <p className="py-8 text-center text-sm text-muted-foreground">暂无匹配用例库</p> : null}</div>
        </aside>

        <div className="min-h-[360px] rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-medium">{activeModuleId ? '当前模块用例' : activeLibraryId ? '当前用例库用例' : '全部可选用例'}</h3>
              <p className="text-xs text-muted-foreground">共 {visibleCases.length} 条 · 勾选状态就是本次提测范围</p>
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="范围筛选">
              {([
                ['ALL', '全部'],
                ['SELECTED', '已选'],
                ['AI', 'AI 推荐'],
              ] as const).map(([value, label]) => (
                <Button key={value} type="button" size="sm" variant={viewFilter === value ? 'default' : 'ghost'} onClick={() => setViewFilter(value)}>{label}</Button>
              ))}
            </div>
          </div>
          <Input className="mt-3" aria-label="搜索用例" placeholder="搜索用例标题、模块或用例库" value={query} onChange={event => setQuery(event.target.value)} />
          {loading ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">范围加载中…</p> : (
            <div className="mt-3 space-y-1">
              {visibleCases.map(item => (
                <div key={item.key} data-case-row={item.key} className="flex items-center gap-2 rounded-md border border-transparent px-2 py-2 hover:border-border hover:bg-muted/30">
                  <NodeCheckbox label={item.title} prefix="选择范围用例" checked={isSelected(item)} onChange={checked => void toggleItem(item, checked)} />
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:underline" onClick={() => setSelectedCase(item)} aria-label={`查看用例 ${item.title}`}>{item.title}</button>
                  {item.moduleName ? <span className="hidden max-w-40 truncate text-xs text-muted-foreground md:inline">{item.moduleName}</span> : null}
                  {item.priority ? <span className="text-xs text-muted-foreground">{item.priority}</span> : null}
                  {item.isAiRecommended ? <Badge variant="secondary">AI 推荐</Badge> : null}
                  {item.action === 'CREATE' ? <Badge variant="secondary">AI 新用例</Badge> : null}
                  {item.action === 'CREATE' ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2" title="保存到用例库" aria-label={`保存 ${item.title} 到用例库`} disabled={Boolean(item.saved) || savingCandidate === item.candidateId} onClick={() => void saveGeneratedCase(item.candidateId!)}><Save className="mr-1 h-3.5 w-3.5" />{item.saved ? '已保存' : '保存到用例库'}</Button> : null}
                </div>
              ))}
              {!visibleCases.length ? <p className="py-10 text-center text-sm text-muted-foreground">{viewFilter === 'SELECTED' ? '还没有选中的用例' : '暂无匹配用例'}</p> : null}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/30 p-3 text-sm">
        <span>已选 {selectedCount} 条用例{removedCount ? ` · 已移除 ${removedCount} 条` : ''}</span>
        <Button disabled={saving || loading || analyzing || !draft?.total} onClick={() => void confirmScope()}>确认范围并进入分派</Button>
      </div>

      {scopeCases.some(item => item.action === 'CREATE') ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/20 p-2 text-xs text-muted-foreground">
          <span>AI 新用例保存到长期库：</span>
          <select className="rounded border bg-background px-2 py-1" aria-label="保存目标用例库" value={saveLibraryId} onChange={event => setSaveLibraryId(event.target.value)}>
            <option value="">选择用例库</option>
            {libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}
          </select>
          <select className="rounded border bg-background px-2 py-1" aria-label="保存目标用例模块" value={saveModuleId} onChange={event => setSaveModuleId(event.target.value)} disabled={!saveLibraryId}>
            <option value="">不指定模块</option>
            {(modulesByLibrary[saveLibraryId] ?? []).map(module => <option key={module.id} value={module.id}>{module.name}</option>)}
          </select>
        </div>
      ) : null}

      {selectedCase ? (
        <aside role="dialog" aria-label="用例详情" className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-y-auto border-l bg-background p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">{selectedCase.libraryName ?? 'AI 生成'}{selectedCase.moduleName ? ` · ${selectedCase.moduleName}` : ''}</p>
              <h3 className="mt-1 text-lg font-semibold">{selectedCase.title}</h3>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="关闭用例详情" onClick={() => setSelectedCase(undefined)}><X className="h-4 w-4" /></Button>
          </div>
          <div className="mt-5 space-y-4 text-sm">
            {selectedCase.precondition ? <div><p className="font-medium">前置条件</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{selectedCase.precondition}</p></div> : null}
            {selectedCase.testData ? <div><p className="font-medium">测试数据</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{selectedCase.testData}</p></div> : null}
            <div><p className="font-medium">测试步骤</p><ol className="mt-1 list-decimal space-y-1 pl-5">{selectedCase.steps.map((step, index) => <li key={`${selectedCase.key}-step-${index}`}>{step}</li>)}</ol></div>
            <div><p className="font-medium">预期结果</p><p className="mt-1 whitespace-pre-wrap">{selectedCase.expected}</p></div>
            {selectedCase.tags?.length ? <div><p className="font-medium">标签</p><div className="mt-1 flex flex-wrap gap-1">{selectedCase.tags.map(tag => <Badge key={tag} variant="outline">{tag}</Badge>)}</div></div> : null}
          </div>
        </aside>
      ) : null}
    </section>
  );
}
