import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { EmptyState } from '../../components/EmptyState';
import { ListToolbar } from '../../components/ListToolbar';
import { MetricCard } from '../../components/MetricCard';
import { PageHeader } from '../../components/PageHeader';
import { RecordListItem } from '../../components/RecordListItem';
import { SectionHeader } from '../../components/SectionHeader';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useToast } from '../../components/ui/toast';
import type { Project, TestRequest, TestRun } from '../../types';
import {
  LoadingState,
  Pagination,
  RefreshButton,
  formatDate,
  runStatusLabels,
  statusBadgeVariant,
} from './quality-ui';

const ALL = '__all__';
const PAGE_SIZE = 10;

interface RunRow {
  request: TestRequest;
  run: TestRun;
}

export function QualityRunsPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [requests, setRequests] = useState<TestRequest[]>([]);

  const projectId = searchParams.get('projectId') ?? ALL;
  const runType = searchParams.get('runType') ?? ALL;
  const status = searchParams.get('status') ?? ALL;
  const keyword = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  async function refresh(silent = false) {
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const [projectList, requestList] = await Promise.all([api.getProjects(), api.getTestRequests()]);
      setProjects(projectList);
      setRequests(requestList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载执行记录失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function updateQuery(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  const rows = useMemo<RunRow[]>(
    () => requests.flatMap((request) => (request.testPlan?.runs ?? []).map((run) => ({ request, run }))),
    [requests],
  );
  const filteredRows = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return rows.filter(({ request, run }) => {
      if (projectId !== ALL && request.projectId !== projectId) return false;
      if (runType !== ALL && run.runType !== runType) return false;
      if (status !== ALL && run.status !== status) return false;
      if (!normalizedKeyword) return true;
      return [run.name, request.title, request.project.name, request.projectVersion.name, run.sourceBug?.title ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normalizedKeyword);
    });
  }, [keyword, projectId, rows, runType, status]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const activeCount = rows.filter((item) => item.run.status === 'ACTIVE').length;
  const regressionCount = rows.filter((item) => item.run.runType === 'REGRESSION').length;
  const exceptionCount = rows.filter((item) => ['FAILED', 'BLOCKED'].includes(item.run.status)).length;

  return (
    <>
      <PageHeader
        eyebrow="测试与质量"
        title="执行记录"
        description="查看初测、Bug 回归及每轮测试结论。"
        actions={<RefreshButton loading={refreshing} onClick={() => void refresh(true)} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="执行轮次" value={rows.length} />
        <MetricCard label="执行中" value={activeCount} />
        <MetricCard label="Bug 回归" value={regressionCount} />
        <MetricCard label="异常结论" value={exceptionCount} />
      </div>

      <section aria-label="执行历史">
        <Card className="rounded-md border border-border bg-card">
          <CardHeader className="pb-4">
            <SectionHeader
              eyebrow="Test Runs"
              title="执行历史"
              description={`当前显示 ${filteredRows.length} 个轮次`}
            />
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <ListToolbar
              search={(
                <Input
                  aria-label="搜索执行记录"
                  placeholder="搜索轮次、提测、项目或版本"
                  value={keyword}
                  onChange={(event) => updateQuery({ q: event.target.value || null, page: null })}
                />
              )}
              filters={(
                <>
                  <Select value={projectId} onValueChange={(value) => updateQuery({ projectId: value, page: null })}>
                    <SelectTrigger className="w-full sm:w-[180px]" aria-label="按项目筛选">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>全部项目</SelectItem>
                      {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={runType} onValueChange={(value) => updateQuery({ runType: value, page: null })}>
                    <SelectTrigger className="w-full sm:w-[140px]" aria-label="按轮次类型筛选">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>全部类型</SelectItem>
                      <SelectItem value="INITIAL">初测</SelectItem>
                      <SelectItem value="LOCAL_SMOKE">本地冒烟</SelectItem>
                      <SelectItem value="REGRESSION">Bug 回归</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={status} onValueChange={(value) => updateQuery({ status: value, page: null })}>
                    <SelectTrigger className="w-full sm:w-[140px]" aria-label="按执行状态筛选">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>全部状态</SelectItem>
                      {Object.entries(runStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </>
              )}
            />

            {loading ? <LoadingState /> : pageRows.length ? (
              <div className="space-y-3">
                {pageRows.map(({ request, run }) => (
                  <RecordListItem
                    key={run.id}
                    title={run.name}
                    badges={(
                      <>
                        <Badge variant={run.runType === 'REGRESSION' ? 'warning' : 'outline'}>
                          {run.runType === 'REGRESSION' ? 'Bug 回归' : run.runType === 'LOCAL_SMOKE' ? '本地冒烟' : '初测'}
                        </Badge>
                        <Badge variant={statusBadgeVariant(run.status)}>{runStatusLabels[run.status] ?? run.status}</Badge>
                      </>
                    )}
                    description={(
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span>{request.project.name}</span>
                        <span>{request.projectVersion.name}</span>
                        <span>{request.title}</span>
                      </div>
                    )}
                    details={run.sourceBug ? <span>来源缺陷：{run.sourceBug.title}</span> : <span>常规提测执行</span>}
                    actions={<span className="text-sm text-muted-foreground">{formatDate(run.startedAt)}</span>}
                  />
                ))}
                <Pagination
                  page={currentPage}
                  total={filteredRows.length}
                  pageSize={PAGE_SIZE}
                  onChange={(nextPage) => updateQuery({ page: String(nextPage) })}
                />
              </div>
            ) : (
              <EmptyState
                title={rows.length ? '没有匹配的执行记录' : '暂无执行记录'}
                description={rows.length ? '调整搜索或筛选条件后重试。' : '提测范围就绪并开始执行后，轮次会显示在这里。'}
              />
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
