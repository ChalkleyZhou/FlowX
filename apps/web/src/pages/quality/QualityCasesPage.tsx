import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, Folder, FolderOpen, FolderTree, Loader2, Pencil, Plus, RotateCw, Trash2, Upload } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useRememberedSearchFilters } from '../../utils/list-filter-storage';
import { api } from '../../api';
import { PagedSelect } from '../../components/PagedSelect';
import { QualityModuleTree } from './QualityModuleTree';
import { useProjectScopeOptional, useScopedProjectId } from '../../project-scope-context';
import { useConfirm } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ListToolbar } from '../../components/ListToolbar';
import { MetricCard } from '../../components/MetricCard';
import { PageHeader } from '../../components/PageHeader';
import { SectionHeader } from '../../components/SectionHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useToast } from '../../components/ui/toast';
import type { TestCaseDefinition, TestCaseLibrary, TestCaseModule, Workspace } from '../../types';
import { CreateCaseDialog, CreateLibraryDialog } from './QualityDialogs';
import { QualityCaseImportDialog } from './QualityCaseImportDialog';
import { QualityCaseEditDialog } from './QualityCaseEditDialog';
import { QualityModuleManagementDialog } from './QualityModuleManagementDialog';
import { LoadingState, Pagination, RefreshButton } from './quality-ui';

const ALL = '__all__';
const PAGE_SIZE = 20;

export function QualityCasesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberedSearchFilters('quality-cases', ['workspaceId', 'caseScope', 'libraryId', 'moduleId', 'priority', 'q']);
  const [metaLoading, setMetaLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [libraries, setLibraries] = useState<TestCaseLibrary[]>([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const listSequence = useRef(0);
  const [expandedLibraries, setExpandedLibraries] = useState<Set<string>>(new Set());
  const [cases, setCases] = useState<TestCaseDefinition[]>([]);
  const [total, setTotal] = useState(0);
  const [p0Count, setP0Count] = useState(0);
  const [linkedCount, setLinkedCount] = useState(0);
  const [libraryDialogOpen, setLibraryDialogOpen] = useState(false);
  const [caseDialogOpen, setCaseDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<TestCaseDefinition | null>(null);
  const [editingCase, setEditingCase] = useState<TestCaseDefinition | null>(null);
  const [deletingCaseId, setDeletingCaseId] = useState<string | null>(null);
  const [caseCreateContext, setCaseCreateContext] = useState<{ libraryId?: string; moduleId?: string }>({});
  const [moduleCreateContext, setModuleCreateContext] = useState<{ libraryId?: string; parentId?: string }>({});

  const scope = useProjectScopeOptional();
  const currentProjectId = useScopedProjectId();
  const caseScope = searchParams.get('caseScope') === 'shared' || !currentProjectId ? 'shared' : 'project';
  const projectWorkspaceId = scope?.projects.find((item) => item.id === currentProjectId)?.workspace.id ?? '';
  const workspaceId = caseScope === 'project' ? projectWorkspaceId : (searchParams.get('workspaceId') ?? '');
  const libraryId = searchParams.get('libraryId') ?? ALL;
  const moduleId = searchParams.get('moduleId') ?? ALL;
  const priority = searchParams.get('priority') ?? ALL;
  const keyword = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const selectedProjectId = caseScope === 'shared' ? undefined : currentProjectId;
  const libraryOwnership = caseScope === 'project' ? 'project' as const : undefined;
  const [searchValue, setSearchValue] = useState(keyword);

  function updateQuery(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  function selectTreeNode(nextLibraryId?: string, nextModuleId?: string) {
    updateQuery({
      libraryId: nextLibraryId ?? null,
      moduleId: nextModuleId ?? null,
      page: null,
    });
  }

  useEffect(() => {
    void (async () => {
      setMetaLoading(true);
      try {
        setWorkspaces((await api.getWorkspaces({ page: 1, pageSize: 1 })).items);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '加载用例库范围失败');
      } finally {
        setMetaLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (caseScope === 'project') {
      if (!projectWorkspaceId || searchParams.get('workspaceId') === projectWorkspaceId) return;
      const next = new URLSearchParams(searchParams);
      next.set('workspaceId', projectWorkspaceId);
      next.delete('libraryId');
      next.delete('page');
      setSearchParams(next, { replace: true });
      return;
    }
    if (searchParams.get('workspaceId') || workspaces.length === 0) return;
    const fallback = projectWorkspaceId || workspaces[0]?.id;
    if (!fallback) return;
    const next = new URLSearchParams(searchParams);
    next.set('workspaceId', fallback);
    setSearchParams(next, { replace: true });
  }, [caseScope, projectWorkspaceId, searchParams, setSearchParams, workspaces]);

  useEffect(() => {
    setSearchValue(keyword);
  }, [keyword]);

  useEffect(() => {
    if (searchValue === keyword) return;
    const timeout = window.setTimeout(() => {
      updateQuery({ q: searchValue.trim() || null, page: null });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [keyword, searchValue]);

  async function refreshList(silent = false) {
    if (!workspaceId) return;
    const sequence = ++listSequence.current;
    silent || cases.length ? setRefreshing(true) : setListLoading(true);
    try {
      const [libraryList, casePage] = await Promise.all([
        api.getTestCaseLibraries({
          workspaceId,
          // 用例目录是树状导航，根节点一次加载完整目录；右侧用例明细单独分页。
          page: 1, pageSize: 100,
          projectId: selectedProjectId,
          ...(libraryOwnership ? { ownership: libraryOwnership } : {}),
        }),
        api.getTestCasesPage({
          workspaceId,
          projectId: selectedProjectId,
          ...(libraryOwnership ? { ownership: libraryOwnership } : {}),
          libraryId: libraryId === ALL ? undefined : libraryId,
          ...(moduleId === ALL ? {} : { moduleId }),
          priority: priority === ALL ? undefined : priority,
          q: keyword.trim() || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
      ]);
      if (sequence !== listSequence.current) return;
      setLibraries(libraryList.items);
      setLibraryTotal(libraryList.total);
      setCases(casePage.items);
      setTotal(casePage.total);
      setP0Count(casePage.summary?.p0Count ?? 0);
      setLinkedCount(casePage.summary?.linkedCount ?? 0);
      const lastPage = Math.max(1, Math.ceil(casePage.total / PAGE_SIZE));
      if (page > lastPage) updateQuery({ page: String(lastPage) });
    } catch (error) {
      if (sequence === listSequence.current) toast.error(error instanceof Error ? error.message : '加载测试用例失败');
    } finally {
      if (sequence === listSequence.current) { setListLoading(false); setRefreshing(false); }
    }
  }

  useEffect(() => {
    void refreshList();
    return () => { listSequence.current += 1; };
  }, [workspaceId, selectedProjectId, libraryId, moduleId, priority, keyword, page]);

  useEffect(() => {
    if (libraryId === ALL) return;
    setExpandedLibraries(current => current.has(libraryId) ? current : new Set(current).add(libraryId));
  }, [libraryId]);

  async function handleDelete(testCase: TestCaseDefinition) {
    const confirmed = await confirm({
      title: '删除测试用例',
      description: `确认删除“${testCase.title}”吗？删除后该用例不再进入新的提测范围，历史提测快照和执行结果仍会保留。`,
      confirmLabel: '删除用例',
      destructive: true,
    });
    if (!confirmed) return;

    setDeletingCaseId(testCase.id);
    try {
      await api.deleteTestCase(testCase.id);
      if (selectedCase?.id === testCase.id) setSelectedCase(null);
      toast.success('测试用例已删除');
      await refreshList(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除测试用例失败');
    } finally {
      setDeletingCaseId(null);
    }
  }

  const hasFilters = Boolean(keyword.trim()) || libraryId !== ALL || priority !== ALL;

  function renderActions(testCase: TestCaseDefinition) {
    return (
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="编辑用例"
          aria-label={`编辑用例：${testCase.title}`}
          onClick={() => setEditingCase(testCase)}
        >
          <Pencil aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="查看用例"
          aria-label={`查看用例：${testCase.title}`}
          onClick={() => setSelectedCase(testCase)}
        >
          <Eye aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-danger hover:bg-danger/10 hover:text-danger"
          title="删除用例"
          aria-label={`删除用例：${testCase.title}`}
          disabled={deletingCaseId === testCase.id}
          onClick={() => void handleDelete(testCase)}
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="测试与质量"
        title="用例库"
        description="统一维护 Workspace 共享用例与项目专属用例。"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="可用用例库" value={libraryTotal} />
        <MetricCard label="当前范围用例" value={total} />
        <MetricCard label="P0 用例" value={p0Count} />
        <MetricCard label="已关联覆盖对象" value={linkedCount} />
      </div>

      <section aria-label="测试用例">
        <Card className="rounded-md border border-border bg-card">
          <CardHeader className="pb-4">
            <SectionHeader
              eyebrow="Test Cases"
              title="测试用例"
              description={`共 ${total} 条用例，每页显示 ${PAGE_SIZE} 条`}
              extra={(
                <>
                  <RefreshButton loading={refreshing} onClick={() => void refreshList(true)} />
                  <Button variant="outline" disabled={!workspaceId} onClick={() => setLibraryDialogOpen(true)}>
                    <Plus aria-hidden="true" className="h-4 w-4" />新建用例库
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!libraries.length}
                    onClick={() => {
                      setModuleCreateContext(libraryId === ALL ? {} : { libraryId });
                      setModuleDialogOpen(true);
                    }}
                  >
                    <FolderTree aria-hidden="true" className="h-4 w-4" />模块管理
                  </Button>
                  <Button variant="outline" disabled={!libraries.length} onClick={() => setImportDialogOpen(true)}>
                    <Upload aria-hidden="true" className="h-4 w-4" />批量导入
                  </Button>
                  <Button
                    disabled={!libraries.length}
                    onClick={() => {
                      setCaseCreateContext(libraryId === ALL ? {} : {
                        libraryId,
                        ...(moduleId === ALL ? {} : { moduleId }),
                      });
                      setCaseDialogOpen(true);
                    }}
                  >
                    <Plus aria-hidden="true" className="h-4 w-4" />新建用例
                  </Button>
                </>
              )}
            />
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
              <aside className="rounded-md border border-border bg-surface-subtle/40 p-3" aria-label="用例目录">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">用例目录</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="筛选全部用例"
                    aria-current={libraryId === ALL && moduleId === ALL ? 'page' : undefined}
                    onClick={() => selectTreeNode()}
                  >
                    <FolderTree aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </div>
                <button
                  type="button"
                  aria-label="筛选全部用例"
                  className={`mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${libraryId === ALL && moduleId === ALL ? 'bg-muted font-medium text-primary' : 'text-foreground'}`}
                  aria-current={libraryId === ALL && moduleId === ALL ? 'page' : undefined}
                  onClick={() => selectTreeNode()}
                >
                  <FolderTree aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  <span>全部用例</span>
                </button>
                {metaLoading ? <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载用例库...</div> : libraries.length ? (
                  <div className="space-y-1">
                    {libraries.map((library) => {
                      const expanded = expandedLibraries.has(library.id);
                      return (
                        <div key={library.id}>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              aria-label={`${expanded ? '收起' : '展开'}用例库：${library.name}`}
                              onClick={() => {
                                setExpandedLibraries((current) => {
                                  const next = new Set(current);
                                  if (next.has(library.id)) next.delete(library.id); else next.add(library.id);
                                  return next;
                                });
                              }}
                            >
                              {expanded ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}
                            </Button>
                            <button
                              type="button"
                              aria-label={`筛选用例库：${library.name}`}
                              aria-current={libraryId === library.id && moduleId === ALL ? 'page' : undefined}
                              className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${libraryId === library.id && moduleId === ALL ? 'bg-muted font-medium text-primary' : 'text-foreground'}`}
                              onClick={() => selectTreeNode(library.id)}
                            >
                              <span className="flex items-center gap-2"><FolderOpen aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{library.name}</span></span>
                            </button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              aria-label={`在用例库“${library.name}”中添加模块`}
                              onClick={() => {
                                setModuleCreateContext({ libraryId: library.id });
                                setModuleDialogOpen(true);
                              }}
                            >
                              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          {expanded ? (
                            <div className="ml-7 mt-1">
                              <QualityModuleTree libraryId={library.id} selectedId={moduleId} onSelect={id => selectTreeNode(library.id, id)} onAdd={parentId => { setModuleCreateContext({ libraryId: library.id, parentId }); setModuleDialogOpen(true); }} />
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="px-2 py-4 text-xs text-muted-foreground">暂无用例库</p>}
              </aside>
              <div className="min-w-0">
            <ListToolbar
              search={(
                <Input
                  aria-label="搜索测试用例"
                  placeholder="搜索标题、编号、预期、用例库或模块"
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                />
              )}
              filters={(
                <>
                  <PagedSelect label="按工作区筛选" value={workspaceId} selectedLabel={workspaces.find(item => item.id === workspaceId)?.name} disabled={caseScope === 'project'} onValueChange={value => { updateQuery({ workspaceId: value, libraryId: null, moduleId: null, page: null }); }} loadPage={query => api.getWorkspaces(query)} />
                  <Select
                    value={caseScope}
                    onValueChange={(value) => updateQuery({ caseScope: value === 'shared' ? 'shared' : null, libraryId: null, page: null })}
                    disabled={!currentProjectId && caseScope === 'shared'}
                  >
                    <SelectTrigger className="w-full sm:w-[190px]" aria-label="按项目范围筛选">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project" disabled={!currentProjectId}>当前项目库</SelectItem>
                      <SelectItem value="shared">Workspace 共享库</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={priority} onValueChange={(value) => updateQuery({ priority: value, page: null })}>
                    <SelectTrigger className="w-full sm:w-[130px]" aria-label="按优先级筛选">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>全部优先级</SelectItem>
                      {['P0', 'P1', 'P2', 'P3'].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              )}
            />

            {listLoading ? <LoadingState /> : cases.length ? (
              <>
                <div className="hidden overflow-x-auto rounded-md border border-border md:block">
                  <table className="w-full min-w-[760px] border-collapse text-sm">
                    <thead className="bg-surface-subtle text-left text-xs font-medium text-muted-foreground">
                      <tr className="border-b border-border">
                        <th scope="col" className="px-4 py-3 font-medium">用例</th>
                        <th scope="col" className="w-56 px-4 py-3 font-medium">归属</th>
                        <th scope="col" className="w-24 px-4 py-3 font-medium">优先级</th>
                        <th scope="col" className="w-24 px-4 py-3 font-medium">覆盖</th>
                        <th scope="col" className="w-36 px-4 py-3 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {cases.map((testCase) => (
                        <tr key={testCase.id} className="transition-colors hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              className="block max-w-xl text-left font-medium text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                              onClick={() => setSelectedCase(testCase)}
                            >
                              {testCase.title}
                            </button>
                            {testCase.externalId ? <span className="mt-1 block font-mono text-xs text-muted-foreground">{testCase.externalId}</span> : null}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            <span className="block text-foreground">{testCase.library?.name ?? '用例库'}</span>
                            <span className="mt-0.5 block text-xs">{testCase.module?.name ?? '未分模块'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={priorityBadgeVariant(testCase.priority)}>{testCase.priority}</Badge>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">
                            {testCase.coverageLinks?.length ?? 0} 项
                          </td>
                          <td className="px-3 py-2">{renderActions(testCase)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-border rounded-md border border-border md:hidden">
                  {cases.map((testCase) => (
                    <div key={testCase.id} className="flex items-start justify-between gap-3 px-3 py-3">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedCase(testCase)}>
                        <span className="block truncate text-sm font-medium text-foreground">{testCase.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant={priorityBadgeVariant(testCase.priority)}>{testCase.priority}</Badge>
                          <span>{testCase.library?.name ?? '用例库'}</span>
                          <span>{testCase.coverageLinks?.length ?? 0} 项覆盖</span>
                        </span>
                      </button>
                      {renderActions(testCase)}
                    </div>
                  ))}
                </div>

                <Pagination
                  page={page}
                  total={total}
                  pageSize={PAGE_SIZE}
                  onChange={(nextPage) => updateQuery({ page: String(nextPage) })}
                />
              </>
            ) : (
              <EmptyState
                title={hasFilters ? '没有匹配的测试用例' : '暂无测试用例'}
                description={hasFilters ? '调整搜索或筛选条件后重试。' : '先创建用例库，再录入测试用例。'}
              />
            )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <Dialog open={Boolean(selectedCase)} onOpenChange={(open) => !open && setSelectedCase(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedCase?.title}</DialogTitle>
            <DialogDescription>用例完整内容与覆盖信息</DialogDescription>
          </DialogHeader>
          {selectedCase ? (
            <div className="space-y-5 text-sm">
              <dl className="grid gap-4 rounded-md border border-border bg-card p-4 sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">用例库</dt><dd className="mt-1 font-medium">{selectedCase.library?.name ?? '用例库'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">模块</dt><dd className="mt-1 font-medium">{selectedCase.module?.name ?? '未分模块'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">优先级</dt><dd className="mt-1"><Badge variant={priorityBadgeVariant(selectedCase.priority)}>{selectedCase.priority}</Badge></dd></div>
                <div><dt className="text-xs text-muted-foreground">版本</dt><dd className="mt-1 font-medium">v{selectedCase.version}</dd></div>
              </dl>
              {selectedCase.precondition ? (
                <div><h3 className="font-medium text-foreground">前置条件</h3><p className="mt-2 leading-6 text-muted-foreground">{selectedCase.precondition}</p></div>
              ) : null}
              {selectedCase.testData ? (
                <div><h3 className="font-medium text-foreground">测试数据</h3><p className="mt-2 whitespace-pre-wrap leading-6 text-muted-foreground">{selectedCase.testData}</p></div>
              ) : null}
              <div>
                <h3 className="font-medium text-foreground">执行步骤</h3>
                <ol className="mt-2 list-decimal space-y-1 pl-5 leading-6 text-muted-foreground">
                  {selectedCase.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
                </ol>
              </div>
              <div>
                <h3 className="font-medium text-foreground">预期结果</h3>
                <p className="mt-2 rounded-md border border-border bg-card p-3 leading-6">{selectedCase.expected}</p>
              </div>
              {selectedCase.tags?.length ? (
                <div>
                  <h3 className="font-medium text-foreground">标签</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedCase.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <CreateLibraryDialog
        open={libraryDialogOpen}
        onOpenChange={setLibraryDialogOpen}
        workspaceId={workspaceId}
        projectId={selectedProjectId}
        onCreated={async () => {
          setLibraryDialogOpen(false);
          await refreshList(true);
        }}
      />
      <CreateCaseDialog
        open={caseDialogOpen}
        onOpenChange={setCaseDialogOpen}
        libraries={libraries}
        workspaceId={workspaceId}
        projectId={selectedProjectId}
        initialLibraryId={caseCreateContext.libraryId}
        initialModuleId={caseCreateContext.moduleId}
        onCreated={async () => {
          setCaseDialogOpen(false);
          setCaseCreateContext({});
          await refreshList(true);
        }}
      />
      <QualityCaseImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        libraries={libraries}
        workspaceId={workspaceId}
        projectId={selectedProjectId}
        defaultLibraryId={libraryId === ALL ? undefined : libraryId}
        onImported={async () => {
          setImportDialogOpen(false);
          await refreshList(true);
        }}
      />
      <QualityCaseEditDialog
        open={Boolean(editingCase)}
        onOpenChange={(open) => !open && setEditingCase(null)}
        testCase={editingCase}
        libraries={libraries}
        workspaceId={workspaceId}
        projectId={selectedProjectId}
        onUpdated={async (updated) => {
          setEditingCase(null);
          setSelectedCase((current) => current?.id === updated.id ? updated : current);
          await refreshList(true);
        }}
      />
      <QualityModuleManagementDialog
        open={moduleDialogOpen}
        onOpenChange={(open) => {
          setModuleDialogOpen(open);
          if (!open) setModuleCreateContext({});
        }}
        libraries={libraries}
        workspaceId={workspaceId}
        projectId={selectedProjectId}
        defaultLibraryId={moduleCreateContext.libraryId ?? (libraryId === ALL ? undefined : libraryId)}
        defaultParentId={moduleCreateContext.parentId}
        onChanged={() => refreshList(true)}
      />
    </>
  );
}

function priorityBadgeVariant(priority: TestCaseDefinition['priority']) {
  if (priority === 'P0') return 'destructive' as const;
  if (priority === 'P1') return 'warning' as const;
  if (priority === 'P3') return 'secondary' as const;
  return 'outline' as const;
}
