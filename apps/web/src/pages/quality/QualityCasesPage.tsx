import { useEffect, useMemo, useState } from 'react';
import { Library, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { ListToolbar } from '../../components/ListToolbar';
import { MetricCard } from '../../components/MetricCard';
import { PageHeader } from '../../components/PageHeader';
import { RecordListItem } from '../../components/RecordListItem';
import { SectionHeader } from '../../components/SectionHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
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
import { LoadingState, Pagination, RefreshButton } from './quality-ui';

const ALL = '__all__';
const SHARED = '__shared__';
const PAGE_SIZE = 10;

export function QualityCasesPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [metaLoading, setMetaLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [libraries, setLibraries] = useState<TestCaseLibrary[]>([]);
  const [cases, setCases] = useState<TestCaseDefinition[]>([]);
  const [libraryDialogOpen, setLibraryDialogOpen] = useState(false);
  const [caseDialogOpen, setCaseDialogOpen] = useState(false);

  const workspaceId = searchParams.get('workspaceId') ?? '';
  const projectId = searchParams.get('projectId') ?? SHARED;
  const libraryId = searchParams.get('libraryId') ?? ALL;
  const keyword = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const selectedProjectId = projectId === SHARED ? undefined : projectId;

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

  async function refreshList(silent = false) {
    if (!workspaceId) return;
    silent ? setRefreshing(true) : setListLoading(true);
    try {
      const [libraryList, caseList] = await Promise.all([
        api.getTestCaseLibraries({ workspaceId, projectId: selectedProjectId }),
        api.getTestCases({ workspaceId, projectId: selectedProjectId }),
      ]);
      setLibraries(libraryList);
      setCases(caseList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载测试用例失败');
    } finally {
      setListLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshList();
  }, [workspaceId, selectedProjectId]);

  const projectsInWorkspace = projects.filter((project) => project.workspace.id === workspaceId);
  const filteredCases = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return cases.filter((testCase) => {
      if (libraryId !== ALL && testCase.libraryId !== libraryId) return false;
      if (!normalizedKeyword) return true;
      return [
        testCase.title,
        testCase.expected,
        testCase.library?.name ?? '',
        testCase.module?.name ?? '',
        ...(testCase.tags ?? []),
      ].join(' ').toLowerCase().includes(normalizedKeyword);
    });
  }, [cases, keyword, libraryId]);

  const totalPages = Math.max(1, Math.ceil(filteredCases.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredCases.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const criticalCount = cases.filter((item) => item.priority === 'P0').length;
  const linkedCount = cases.filter((item) => Boolean(item.coverageLinks?.length)).length;

  return (
    <>
      <PageHeader
        eyebrow="测试与质量"
        title="用例库"
        description="统一维护 Workspace 共享用例与项目专属用例。"
        icon={Library}
        actions={(
          <>
            <RefreshButton loading={refreshing} onClick={() => void refreshList(true)} />
            <Button variant="outline" disabled={!workspaceId} onClick={() => setLibraryDialogOpen(true)}>
              <Plus aria-hidden="true" className="h-4 w-4" />新建用例库
            </Button>
            <Button disabled={!libraries.length} onClick={() => setCaseDialogOpen(true)}>
              <Plus aria-hidden="true" className="h-4 w-4" />新建用例
            </Button>
          </>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="可用用例库" value={libraries.length} />
        <MetricCard label="用例总数" value={cases.length} />
        <MetricCard label="P0 用例" value={criticalCount} />
        <MetricCard label="已关联覆盖对象" value={linkedCount} />
      </div>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Test Cases"
          title="测试用例"
          description={`当前显示 ${filteredCases.length} 条用例`}
          className="border-b border-border pb-4"
        />
        <ListToolbar
          search={(
            <Input
              aria-label="搜索测试用例"
              placeholder="搜索标题、预期结果、模块或标签"
              value={keyword}
              onChange={(event) => updateQuery({ q: event.target.value || null, page: null })}
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
            </>
          )}
        />

        {listLoading ? <LoadingState /> : pageRows.length ? (
          <div className="space-y-3">
            {pageRows.map((testCase) => (
              <RecordListItem
                key={testCase.id}
                title={testCase.title}
                badges={(
                  <>
                    <Badge variant={testCase.priority === 'P0' ? 'destructive' : 'outline'}>{testCase.priority}</Badge>
                    <Badge variant="secondary">v{testCase.version}</Badge>
                    <Badge variant="outline">{testCase.library?.scope === 'PROJECT' ? '项目用例' : '共享用例'}</Badge>
                  </>
                )}
                description={(
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>{testCase.library?.name ?? '用例库'}</span>
                    {testCase.module?.name ? <span>模块：{testCase.module.name}</span> : null}
                    <span>{testCase.steps.length} 个步骤</span>
                    <span>{testCase.coverageLinks?.length ?? 0} 个覆盖关联</span>
                  </div>
                )}
                details={<span><span className="text-foreground">预期：</span>{testCase.expected}</span>}
                actions={testCase.tags?.length ? (
                  <div className="flex max-w-72 flex-wrap justify-end gap-1.5 max-[1180px]:justify-start">
                    {testCase.tags.slice(0, 3).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                ) : null}
              />
            ))}
            <Pagination
              page={currentPage}
              total={filteredCases.length}
              pageSize={PAGE_SIZE}
              onChange={(nextPage) => updateQuery({ page: String(nextPage) })}
            />
          </div>
        ) : (
          <EmptyState
            title={cases.length ? '没有匹配的测试用例' : '暂无测试用例'}
            description={cases.length ? '调整搜索或筛选条件后重试。' : '先创建用例库，再录入测试用例。'}
          />
        )}
      </section>

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
    </>
  );
}
