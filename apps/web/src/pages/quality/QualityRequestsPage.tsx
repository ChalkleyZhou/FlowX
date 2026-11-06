import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRememberedSearchFilters } from '../../utils/list-filter-storage';
import { api } from '../../api';
import { useQualityPage } from './use-quality-page';
import { useScopedProjectId } from '../../project-scope-context';
import { EmptyState } from '../../components/EmptyState';
import { ProjectRequiredState } from '../../components/ProjectRequiredState';
import { ListToolbar } from '../../components/ListToolbar';
import { MetricCard } from '../../components/MetricCard';
import { PageHeader } from '../../components/PageHeader';
import { RecordListItem } from '../../components/RecordListItem';
import { SectionHeader } from '../../components/SectionHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import type { Project, TestRequest, WorkflowRun } from '../../types';
import { CreateRequestDialog } from './QualityDialogs';
import {
  LoadingState,
  Pagination,
  RefreshButton,
  formatDate,
  requestStatusLabels,
  statusBadgeVariant,
} from './quality-ui';

const ALL = '__all__';
const PAGE_SIZE = 8;

export function QualityRequestsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  useRememberedSearchFilters('quality-requests', ['status', 'q']);
  const createFromWorkflow = searchParams.get('create') === '1';
  const projectId = useScopedProjectId();
  const initialProjectId = projectId || undefined;
  const initialProjectVersionId = searchParams.get('projectVersionId') ?? undefined;
  const initialWorkflowRunId = searchParams.get('workflowRunId') ?? undefined;
  const [dialogOpen, setDialogOpen] = useState(createFromWorkflow);

  const status = searchParams.get('status') ?? ALL;
  const keyword = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const result = useQualityPage(JSON.stringify({ projectId, page, status, keyword }), () =>
    api.getTestRequests({ projectId, page, pageSize: PAGE_SIZE, status: status === ALL ? undefined : status, q: keyword.trim() || undefined }), Boolean(projectId), nextPage => updateQuery({ page: String(nextPage) }));
  const { loading, refreshing, items: requests, total, summary = {} } = result;
  const refresh = (silent = false) => result.refresh({ silent });
  const [projects, setProjects] = useState<Project[]>([]);
  const [workflowRuns] = useState<WorkflowRun[]>([]);
  useEffect(() => {
    if (!dialogOpen || !projectId) return;
    void api.getProject(projectId).then(project => setProjects([project]));
  }, [dialogOpen, projectId]);

  useEffect(() => {
    if (createFromWorkflow) {
      setDialogOpen(true);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('create');
        return next;
      }, { replace: true });
    }
  }, [createFromWorkflow, setSearchParams]);

  function updateQuery(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  const currentPage = page;
  const pageRows = requests;
  const activeCount = summary.activeCount ?? 0;
  const readyCount = summary.readyCount ?? 0;
  const passedCount = summary.passedCount ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="测试与质量"
        title="提测管理"
        description="按项目版本追踪测试范围、执行进度和最终结论。"
        actions={(
          <>
            <RefreshButton loading={refreshing} onClick={() => void refresh(true)} />
            <Button onClick={() => setDialogOpen(true)}><Plus aria-hidden="true" className="h-4 w-4" />发起提测</Button>
          </>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="提测总数" value={summary.total ?? total} />
        <MetricCard label="进行中" value={activeCount} />
        <MetricCard label="待执行" value={readyCount} />
        <MetricCard label="已通过" value={passedCount} />
      </div>

      <section aria-label="提测记录">
        <Card className="rounded-md border border-border bg-card">
          <CardHeader className="pb-4">
            <SectionHeader
              eyebrow="Test Requests"
              title="提测记录"
              description={`当前显示 ${total} 条记录`}
            />
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <ListToolbar
              search={(
                <Input
                  aria-label="搜索提测记录"
                  placeholder="搜索标题、项目、版本或需求"
                  value={keyword}
                  onChange={(event) => updateQuery({ q: event.target.value || null, page: null })}
                />
              )}
              filters={(
                <>
                  <Select value={status} onValueChange={(value) => updateQuery({ status: value, page: null })}>
                    <SelectTrigger className="w-full sm:w-[150px]" aria-label="按状态筛选">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>全部状态</SelectItem>
                      {Object.entries(requestStatusLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            />

            {result.error ? <p role="alert">{result.error}<button onClick={() => void refresh()}>重试</button></p> : null}
            {!projectId ? <ProjectRequiredState /> : loading ? <LoadingState /> : pageRows.length ? (
              <div className="space-y-3">
                {pageRows.map((request) => (
                  <RecordListItem
                    key={request.id}
                    title={<Link className="hover:text-primary hover:underline" to={`/quality/test-requests/${request.id}`}>{request.title}</Link>}
                    badges={(
                      <>
                        <Badge variant={statusBadgeVariant(request.status)}>{requestStatusLabels[request.status] ?? request.status}</Badge>
                        <Badge variant="outline">{request.projectVersion.name}</Badge>
                      </>
                    )}
                    description={(
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span>{request.project.name}</span>
                        <span>{request._count?.requirementLinks ?? request.requirementLinks?.length ?? 0} 个需求</span>
                        <span>{request.testPlan?._count?.snapshots ?? request.testPlan?.snapshots?.length ?? 0} 个范围用例</span>
                        <span>{request.testPlan?._count?.runs ?? request.testPlan?.runs?.length ?? 0} 个执行轮次</span>
                      </div>
                    )}
                    details={request.scopeSummary ? <span>{request.scopeSummary}</span> : <span>测试范围尚未生成完成</span>}
                    actions={(
                      <div className="flex items-center gap-3 text-sm">
                        {request.testDesignId ? <Link className="text-primary hover:underline" to={`/quality/test-designs/${request.testDesignId}`}>测试设计</Link> : null}
                        <Link className="text-primary hover:underline" to={`/quality/test-requests/${request.id}`}>冒烟与报告</Link>
                        <span className="text-muted-foreground">{formatDate(request.createdAt)}</span>
                      </div>
                    )}
                  />
                ))}
                <Pagination
                  page={currentPage}
                  total={total}
                  pageSize={PAGE_SIZE}
                  onChange={(nextPage) => updateQuery({ page: String(nextPage) })}
                />
              </div>
            ) : (
              <EmptyState
                title={requests.length ? '没有匹配的提测记录' : '暂无提测记录'}
                description={requests.length ? '调整搜索或筛选条件后重试。' : '发起提测后，记录会显示在这里。'}
              />
            )}
          </CardContent>
        </Card>
      </section>

      <CreateRequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projects={projects}
        workflowRuns={workflowRuns}
        initialProjectId={initialProjectId}
        initialProjectVersionId={initialProjectVersionId}
        initialWorkflowRunId={initialWorkflowRunId}
        onCreated={async () => {
          setDialogOpen(false);
          await refresh(true);
        }}
      />
    </>
  );
}
