import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderTree, Library, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../../api';
import type { TestCaseDefinition, TestCaseLibrary, TestCaseModule, TestDesignCandidate, TestRequest, TestRequestScopeDraft } from '../../types';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';

type ScopeNode = { id: string; title: string; priority?: string; libraryId?: string; libraryName?: string; moduleId?: string | null; moduleName?: string | null; candidateId?: string; action?: TestDesignCandidate['action']; saved?: boolean };

function TreeToggle({ expanded, label, onClick }: { expanded: boolean; label: string; onClick: () => void }) {
  return <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={`${expanded ? '收起' : '展开'}${label}`} onClick={onClick}>{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</Button>;
}

function NodeCheckbox({ label, checked, onChange, prefix = '选择' }: { label: string; checked: boolean; onChange: (checked: boolean) => void; prefix?: string }) {
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
  const [leftSelected, setLeftSelected] = useState<string[]>([]);
  const [rightSelected, setRightSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingCandidate, setSavingCandidate] = useState<string>();
  const [saveLibraryId, setSaveLibraryId] = useState('');
  const [saveModuleId, setSaveModuleId] = useState('');

  async function loadDraft({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true);
    try { setDraft(await api.getTestRequestScopeDraft(request.id, { page: 1, pageSize: 100, q: query || undefined })); }
    catch (error) { if (!silent) toast.error(error instanceof Error ? error.message : '加载 AI 提测范围失败'); }
    finally { if (!silent) setLoading(false); }
  }
  useEffect(() => { void loadDraft(); }, [request.id, query]);
  useEffect(() => {
    void api.getTestCaseLibraries({ workspaceId: request.workspaceId, projectId: request.projectId, page: 1, pageSize: 100 }).then(result => { setLibraries(result.items); setSaveLibraryId(current => current || result.items[0]?.id || ''); }).catch(() => toast.error('加载用例库失败'));
  }, [request.workspaceId, request.projectId]);
  useEffect(() => {
    if (!['GENERATING', 'NOT_STARTED'].includes(request.testDesign?.status ?? request.scopeGenerationStatus)) return;
    const timer = window.setInterval(() => void loadDraft({ silent: true }), 2000); return () => window.clearInterval(timer);
  }, [request.id, request.testDesign?.status, request.scopeGenerationStatus, query]);

  async function expandLibrary(libraryId: string) {
    setExpandedLibraries(current => current.includes(libraryId) ? current.filter(id => id !== libraryId) : [...current, libraryId]);
    if (modulesByLibrary[libraryId]) return;
    setTreeLoading(true);
    try { const result = await api.getTestCaseModules(libraryId, { page: 1, pageSize: 100 }); setModulesByLibrary(current => ({ ...current, [libraryId]: result.items })); }
    catch (error) { toast.error(error instanceof Error ? error.message : '加载用例模块失败'); }
    finally { setTreeLoading(false); }
  }
  async function expandModule(module: TestCaseModule) {
    setExpandedModules(current => current.includes(module.id) ? current.filter(id => id !== module.id) : [...current, module.id]);
    if (casesByModule[module.id]) return;
    setTreeLoading(true);
    try { const result = await api.getTestCasesPage({ workspaceId: request.workspaceId, projectId: request.projectId, libraryId: module.libraryId, moduleId: module.id, page: 1, pageSize: 100 }); setCasesByModule(current => ({ ...current, [module.id]: result.items })); }
    catch (error) { toast.error(error instanceof Error ? error.message : '加载模块用例失败'); }
    finally { setTreeLoading(false); }
  }

  const candidates = useMemo(() => (draft?.items ?? []).filter(item => item.action !== 'EXCLUDE'), [draft]);
  const rightNodes = useMemo<ScopeNode[]>(() => candidates.map(item => ({ id: item.id, title: item.proposedCase.title, priority: item.proposedCase.priority, libraryId: item.sourceDefinition?.libraryId, libraryName: item.sourceDefinition?.library?.name, moduleId: item.sourceDefinition?.moduleId, moduleName: item.sourceDefinition?.module?.name, candidateId: item.id, action: item.action, saved: Boolean(item.sourceDefinitionId) })), [candidates]);
  const includedCaseIds = useMemo(() => new Set(candidates.map(item => item.sourceDefinitionId).filter((id): id is string => Boolean(id))), [candidates]);
  const filteredLibraries = useMemo(() => libraries.filter(library => !query.trim() || library.name.toLowerCase().includes(query.trim().toLowerCase())), [libraries, query]);
  const removedCount = draft ? (draft.summary?.EXCLUDE ?? 0) + (draft.summary?.REJECTED ?? 0) : 0;

  function toggleSelected(id: string, checked: boolean, side: 'left' | 'right') {
    const setter = side === 'left' ? setLeftSelected : setRightSelected;
    setter(current => checked ? [...new Set([...current, id])] : current.filter(item => item !== id));
  }
  function toggleLibrarySelection(library: TestCaseLibrary, checked: boolean) {
    const ids = (modulesByLibrary[library.id] ?? []).flatMap(module => (casesByModule[module.id] ?? []).map(item => `case:${item.id}`));
    setLeftSelected(current => checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)));
  }
  function toggleModuleSelection(module: TestCaseModule, checked: boolean) {
    const ids = (casesByModule[module.id] ?? []).map(item => `case:${item.id}`);
    setLeftSelected(current => checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)));
  }
  async function addSelected() {
    const ids = leftSelected.filter(id => id.startsWith('case:')).map(id => id.slice(5)).filter(id => !includedCaseIds.has(id));
    if (!ids.length) return;
    setSaving(true);
    try { await api.addTestRequestScopeDraftCases(request.id, { selections: ids.map(caseId => ({ caseId, reason: '人工补充提测范围', impactLevel: 'MEDIUM' as const })) }); setLeftSelected([]); await loadDraft(); toast.success(`已加入 ${ids.length} 条用例`); }
    catch (error) { toast.error(error instanceof Error ? error.message : '加入提测范围失败'); }
    finally { setSaving(false); }
  }
  async function removeSelected() {
    if (!draft || !rightSelected.length) return;
    setSaving(true);
    try { await api.updateTestRequestScopeDraft(request.id, { scopeRevision: draft.scopeRevision, removedCandidateIds: rightSelected }); setRightSelected([]); await loadDraft(); toast.success(`已移出 ${rightSelected.length} 条用例`); }
    catch (error) { toast.error(error instanceof Error ? error.message : '移出提测范围失败'); }
    finally { setSaving(false); }
  }
  async function confirmScope() {
    if (!draft) return;
    setSaving(true);
    try { const next = await api.prepareTestRequest(request.id, { scopeRevision: draft.scopeRevision }); onConfirmed(next); toast.success('范围已确认，请继续分派执行人'); }
    catch (error) { toast.error(error instanceof Error ? error.message : '确认提测范围失败'); }
    finally { setSaving(false); }
  }
  async function saveGeneratedCase(candidateId: string) {
    if (!saveLibraryId) { toast.error('请先选择保存目标用例库'); return; }
    setSavingCandidate(candidateId);
    try { await api.saveGeneratedTestRequestCase(request.id, candidateId, { libraryId: saveLibraryId, ...(saveModuleId ? { moduleId: saveModuleId } : {}) }); setDraft(current => current ? { ...current, items: current.items.map(item => item.id === candidateId ? { ...item, sourceDefinitionId: 'saved' } : item) } : current); toast.success('AI 新用例已保存到用例库'); }
    catch (error) { toast.error(error instanceof Error ? error.message : '保存 AI 新用例失败'); }
    finally { setSavingCandidate(undefined); }
  }

  const renderModule = (module: TestCaseModule) => {
    const cases = (casesByModule[module.id] ?? []).filter(item => !query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase()));
    const moduleCaseIds = cases.map(item => `case:${item.id}`);
    return <div key={module.id} className="space-y-1"><div className="flex items-center gap-1 rounded px-1 py-1 hover:bg-muted/40"><NodeCheckbox label={module.name} prefix="选择模块" checked={Boolean(moduleCaseIds.length && moduleCaseIds.every(id => leftSelected.includes(id)))} onChange={checked => toggleModuleSelection(module, checked)} /><TreeToggle expanded={expandedModules.includes(module.id)} label={`模块 ${module.name}`} onClick={() => void expandModule(module)} /><FolderTree className="h-4 w-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm">{module.name}</span><span className="text-xs text-muted-foreground">{module._count?.cases ?? cases.length}</span></div>{expandedModules.includes(module.id) ? <div className="ml-5 space-y-1">{cases.map(item => <label key={item.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/40"><NodeCheckbox label={item.title} prefix="选择用例" checked={leftSelected.includes(`case:${item.id}`)} onChange={checked => toggleSelected(`case:${item.id}`, checked, 'left')} /><span className="min-w-0 flex-1 truncate">{item.title}</span><span className="text-xs text-muted-foreground">{item.priority}</span>{includedCaseIds.has(item.id) ? <span className="text-xs text-muted-foreground">已在范围</span> : null}</label>)}</div> : null}</div>;
  };
  const renderLibrary = (library: TestCaseLibrary) => {
    const modules = (modulesByLibrary[library.id] ?? []).filter(module => !module.parentId);
    const libraryCaseIds = modules.flatMap(module => (casesByModule[module.id] ?? []).map(item => `case:${item.id}`));
    return <div key={library.id} className="space-y-1"><div className="flex items-center gap-1 rounded px-1 py-1 hover:bg-muted/40"><NodeCheckbox label={library.name} prefix="选择用例库" checked={Boolean(libraryCaseIds.length && libraryCaseIds.every(id => leftSelected.includes(id)))} onChange={checked => toggleLibrarySelection(library, checked)} /><TreeToggle expanded={expandedLibraries.includes(library.id)} label={`用例库 ${library.name}`} onClick={() => void expandLibrary(library.id)} /><Library className="h-4 w-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{library.name}</span><Badge variant="outline">{library.scope === 'WORKSPACE' ? '共享' : '项目'}</Badge></div>{expandedLibraries.includes(library.id) ? <div className="ml-4 space-y-1">{modules.map(renderModule)}</div> : null}</div>;
  };

  const rightGroups = useMemo(() => {
    const groups = new Map<string, ScopeNode[]>();
    for (const node of rightNodes.filter(item => !query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase()))) { const key = `${node.libraryId ?? 'generated'}:${node.moduleId ?? 'generated'}`; groups.set(key, [...(groups.get(key) ?? []), node]); }
    return [...groups.entries()];
  }, [rightNodes, query]);
  const analyzing = request.testDesign?.status === 'GENERATING' || request.scopeGenerationStatus === 'GENERATING';
  return <section className="space-y-4 rounded-md border p-4" aria-label="AI 提测范围">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">AI 提测范围</h2><p className="mt-1 text-sm text-muted-foreground">从用例库树中加入或移出范围，AI 推荐已默认放在右侧。</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">AI 推荐 {candidates.length}</Badge><Badge variant="outline">当前范围 {candidates.length}</Badge><Badge variant="outline">已移除 {removedCount}</Badge></div></div>
    {analyzing ? <p role="status" className="rounded-md bg-muted/40 p-3 text-sm">AI 正在读取需求、方案和代码变更并生成范围…</p> : null}
    <div className="flex flex-wrap items-center gap-2"><Input className="max-w-sm" placeholder="搜索用例库、模块或用例" value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索用例范围" />{treeLoading ? <span className="text-xs text-muted-foreground">树节点加载中…</span> : null}</div>
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="min-h-[280px] rounded-md border p-3"><div className="mb-2 flex items-center justify-between"><h3 className="font-medium">可选用例库</h3><span className="text-xs text-muted-foreground">{libraries.length} 个库</span></div><div className="space-y-1">{filteredLibraries.map(renderLibrary)}{!filteredLibraries.length ? <p className="py-8 text-center text-sm text-muted-foreground">暂无匹配用例库</p> : null}</div></div>
      <div className="flex flex-row items-center justify-center gap-2 lg:flex-col"><Button type="button" size="sm" variant="outline" disabled={saving || !leftSelected.length} onClick={() => void addSelected()} aria-label="加入范围"><Plus className="mr-1 h-4 w-4" />加入范围</Button><Button type="button" size="sm" variant="outline" disabled={saving || !rightSelected.length} onClick={() => void removeSelected()} aria-label="移出范围"><Trash2 className="mr-1 h-4 w-4" />移出范围</Button></div>
      <div className="min-h-[280px] rounded-md border p-3"><div className="mb-2 flex items-center justify-between"><h3 className="font-medium">本次提测范围</h3><span className="text-xs text-muted-foreground">{rightNodes.length} 条用例</span></div>{loading ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">范围加载中…</p> : <div className="space-y-2">{rightGroups.map(([group, nodes]) => <div key={group} className="rounded bg-muted/20 p-2"><div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Library className="h-3.5 w-3.5" />{nodes[0]?.libraryName ?? 'AI 生成'}<span>· {nodes[0]?.moduleName ?? '未分模块'} · {nodes.length} 条</span></div>{nodes.map(node => <div key={node.id} className="flex items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted/40"><NodeCheckbox label={node.title} checked={rightSelected.includes(node.id)} onChange={checked => toggleSelected(node.id, checked, 'right')} prefix="选择范围用例" /><span className="min-w-0 flex-1 truncate">{node.title}</span>{node.priority ? <span className="text-xs text-muted-foreground">{node.priority}</span> : null}{node.action === 'CREATE' ? <Badge variant="secondary">AI 新用例</Badge> : null}{node.action === 'CREATE' ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2" title="保存到用例库" aria-label={`保存 ${node.title} 到用例库`} disabled={Boolean(node.saved) || savingCandidate === node.candidateId} onClick={() => void saveGeneratedCase(node.candidateId!)}><Save className="mr-1 h-3.5 w-3.5" />{node.saved ? '已保存' : '保存到用例库'}</Button> : null}</div>)}</div>)}{!rightGroups.length ? <p className="py-8 text-center text-sm text-muted-foreground">当前没有可纳入的用例</p> : null}</div>}</div>
    </div>
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground"><span>AI 新用例保存到长期库：</span><select className="rounded border bg-background px-2 py-1" aria-label="保存目标用例库" value={saveLibraryId} onChange={event => setSaveLibraryId(event.target.value)}><option value="">选择用例库</option>{libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}</select><select className="rounded border bg-background px-2 py-1" aria-label="保存目标用例模块" value={saveModuleId} onChange={event => setSaveModuleId(event.target.value)} disabled={!saveLibraryId}><option value="">不指定模块</option>{(modulesByLibrary[saveLibraryId] ?? []).map(module => <option key={module.id} value={module.id}>{module.name}</option>)}</select></div>
    <div className="flex justify-end"><Button disabled={saving || loading || analyzing || !draft?.total} onClick={() => void confirmScope()}>确认范围并进入分派</Button></div>
  </section>;
}
