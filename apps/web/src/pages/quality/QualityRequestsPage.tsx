import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
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
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [requests, setRequests] = useState<TestRequest[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const projectId = searchParams.get('projectId') ?? ALL;
  const status = searchParams.get('status') ?? ALL;
  const keyword = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  async function refresh(silent = false) {
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const [projectList, workflowList, requestList] = await Promise.all([
        api.getProjects(),
        api.getWorkflowRuns(),
        api.getTestRequests(),
      ]);
      setProjects(projectList);
      setWorkflowRuns(workflowList);
      setRequests(requestList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载提测记录失败');
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

  const filteredRequests = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return requests.filter((request) => {
      if (projectId !== ALL && request.projectId !== projectId) return false;
      if (status !== ALL && request.status !== status) return false;
      if (!normalizedKeyword) return true;
      return [
        request.title,
        request.description ?? '',
        request.project.name,
        request.projectVersion.name,
        ...request.requirementLinks.map((link) => link.requirement.title),
      ].join(' ').toLowerCase().includes(normalizedKeyword);
    });
  }, [keyword, projectId, requests, status]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRequests.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const activeCount = requests.filter((item) => ['DRAFT', 'READY', 'IN_TEST'].includes(item.status)).length;
  const readyCount = requests.filter((item) => item.status === 'READY').length;
  const passedCount = requests.filter((item) => item.status === 'PASSED').length;

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
        <MetricCard label="提测总数" value={requests.length} />
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
              description={`当前显示 ${filteredRequests.length} 条记录`}
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
                  <Select value={projectId} onValueChange={(value) => updateQuery({ projectId: value, page: null })}>
                    <SelectTrigger className="w-full sm:w-[190px]" aria-label="按项目筛选">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>全部项目</SelectItem>
                      {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
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

            {loading ? <LoadingState /> : pageRows.length ? (
              <div className="space-y-3">
                {pageRows.map((request) => (
                  <RecordListItem
                    key={request.id}
                    title={request.title}
                    badges={(
                      <>
                        <Badge variant={statusBadgeVariant(request.status)}>{requestStatusLabels[request.status] ?? request.status}</Badge>
                        <Badge variant="outline">{request.projectVersion.name}</Badge>
                      </>
                    )}
                    description={(
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span>{request.project.name}</span>
                        <span>{request.requirementLinks.length} 个需求</span>
                        <span>{request.testPlan?.snapshots.length ?? 0} 个范围用例</span>
                        <span>{request.testPlan?.runs.length ?? 0} 个执行轮次</span>
                      </div>
                    )}
                    details={request.scopeSummary ? <span>{request.scopeSummary}</span> : <span>测试范围尚未生成完成</span>}
                    actions={<span className="text-sm text-muted-foreground">{formatDate(request.createdAt)}</span>}
                  />
                ))}
                <Pagination
                  page={currentPage}
                  total={filteredRequests.length}
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
        onCreated={async () => {
          setDialogOpen(false);
          await refresh(true);
        }}
      />
    </>
  );
}
