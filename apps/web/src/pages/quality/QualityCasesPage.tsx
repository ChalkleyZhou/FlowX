import { useEffect, useState } from 'react';
import { Eye, FolderTree, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
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
import type { Project, TestCaseDefinition, TestCaseLibrary, Workspace } from '../../types';
import { CreateCaseDialog, CreateLibraryDialog } from './QualityDialogs';
import { QualityCaseImportDialog } from './QualityCaseImportDialog';
import { QualityCaseEditDialog } from './QualityCaseEditDialog';
import { QualityModuleManagementDialog } from './QualityModuleManagementDialog';
import { LoadingState, Pagination, RefreshButton } from './quality-ui';

const ALL = '__all__';
const SHARED = '__shared__';
const PAGE_SIZE = 20;

export function QualityCasesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [metaLoading, setMetaLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [libraries, setLibraries] = useState<TestCaseLibrary[]>([]);
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

  const workspaceId = searchParams.get('workspaceId') ?? '';
  const projectId = searchParams.get('projectId') ?? SHARED;
  const libraryId = searchParams.get('libraryId') ?? ALL;
  const priority = searchParams.get('priority') ?? ALL;
  const keyword = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const selectedProjectId = projectId === SHARED ? undefined : projectId;
  const [searchValue, setSearchValue] = useState(keyword);

  function updateQuery(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === ALL || (key === 'projectId' && value === SHARED)) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    void (async () => {
      setMetaLoading(true);
      try {
        const [workspaceList, projectList] = await Promise.all([api.getWorkspaces(), api.getProjects()]);
        setWorkspaces(workspaceList);
        setProjects(projectList);
        if (!workspaceId && workspaceList[0]?.id) {
          const next = new URLSearchParams(searchParams);
          next.set('workspaceId', workspaceList[0].id);
          setSearchParams(next, { replace: true });
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '加载用例库范围失败');
      } finally {
        setMetaLoading(false);
      }
    })();
  }, []);

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
    silent ? setRefreshing(true) : setListLoading(true);
    try {
      const [libraryList, casePage] = await Promise.all([
        api.getTestCaseLibraries({ workspaceId, projectId: selectedProjectId }),
        api.getTestCasesPage({
          workspaceId,
          projectId: selectedProjectId,
          libraryId: libraryId === ALL ? undefined : libraryId,
          priority: priority === ALL ? undefined : priority,
          q: keyword.trim() || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
      ]);
      setLibraries(libraryList);
      setCases(casePage.items);
      setTotal(casePage.total);
      setP0Count(casePage.summary.p0Count);
      setLinkedCount(casePage.summary.linkedCount);
      const lastPage = Math.max(1, Math.ceil(casePage.total / PAGE_SIZE));
      if (page > lastPage) updateQuery({ page: String(lastPage) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载测试用例失败');
    } finally {
      setListLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshList();
  }, [workspaceId, selectedProjectId, libraryId, priority, keyword, page]);

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

  const projectsInWorkspace = projects.filter((project) => project.workspace.id === workspaceId);
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
        <MetricCard label="可用用例库" value={libraries.length} />
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
                  <Button variant="outline" disabled={!libraries.length} onClick={() => setModuleDialogOpen(true)}>
                    <FolderTree aria-hidden="true" className="h-4 w-4" />模块管理
                  </Button>
                  <Button variant="outline" disabled={!libraries.length} onClick={() => setImportDialogOpen(true)}>
                    <Upload aria-hidden="true" className="h-4 w-4" />批量导入
                  </Button>
                  <Button disabled={!libraries.length} onClick={() => setCaseDialogOpen(true)}>
                    <Plus aria-hidden="true" className="h-4 w-4" />新建用例
                  </Button>
                </>
              )}
            />
          </CardHeader>
          <CardContent className="p-5 pt-0">
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
                  <Select
                    value={workspaceId || undefined}
                    onValueChange={(value) => updateQuery({ workspaceId: value, projectId: null, libraryId: null, page: null })}
                    disabled={metaLoading}
                  >
                    <SelectTrigger className="w-full sm:w-[180px]" aria-label="按工作区筛选">
                      <SelectValue placeholder="选择工作区" />
                    </SelectTrigger>
                    <SelectContent>
                      {workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={projectId} onValueChange={(value) => updateQuery({ projectId: value, libraryId: null, page: null })}>
                    <SelectTrigger className="w-full sm:w-[190px]" aria-label="按项目范围筛选">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SHARED}>Workspace 共享库</SelectItem>
                      {projectsInWorkspace.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={libraryId} onValueChange={(value) => updateQuery({ libraryId: value, page: null })}>
                    <SelectTrigger className="w-full sm:w-[180px]" aria-label="按用例库筛选">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>全部用例库</SelectItem>
                      {libraries.map((library) => <SelectItem key={library.id} value={library.id}>{library.name}</SelectItem>)}
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
        onCreated={async () => {
          setCaseDialogOpen(false);
          await refreshList(true);
        }}
      />
      <QualityCaseImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        libraries={libraries}
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
        onUpdated={async (updated) => {
          setEditingCase(null);
          setSelectedCase((current) => current?.id === updated.id ? updated : current);
          await refreshList(true);
        }}
      />
      <QualityModuleManagementDialog
        open={moduleDialogOpen}
        onOpenChange={setModuleDialogOpen}
        libraries={libraries}
        defaultLibraryId={libraryId === ALL ? undefined : libraryId}
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
