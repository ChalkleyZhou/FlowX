import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useListPage } from '../hooks/use-list-page';
import { PagedSelect } from '../components/PagedSelect';
import { ListPagination } from '../components/ListPagination';
import { EmptyState } from '../components/EmptyState';
import { ProjectRequiredState } from '../components/ProjectRequiredState';
import { ListToolbar } from '../components/ListToolbar';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { RecordListItem } from '../components/RecordListItem';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button as UiButton } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import { useConfirm } from '../components/ConfirmDialog';
import type { Requirement, WorkflowRun, Workspace } from '../types';
import { useScopedProjectId } from '../project-scope-context';
import { useRememberedSearchFilters } from '../utils/list-filter-storage';
import { formatWorkflowRunType, formatWorkflowStatus } from '../utils/workflow-ui';

export function WorkflowRunsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  useRememberedSearchFilters('workflow-runs', ['workspaceId', 'requirementId', 'runType']);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [selectedRequirement, setSelectedRequirement] = useState<Requirement | null>(null);
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const workspaceId = searchParams.get('workspaceId') ?? '';
  const projectId = useScopedProjectId();
  const requirementId = searchParams.get('requirementId') ?? '';
  const runType = searchParams.get('runType') ?? '';

  const list = useListPage(api.getWorkflowRuns, { projectId: projectId || undefined, workspaceId: workspaceId || undefined, requirementId: requirementId || undefined, runType: runType || undefined }, {enabled:Boolean(projectId)});
  const {items: workflowRuns, loading, refresh} = list;
  const workflowSummary = {total:list.summary?.total ?? list.total,visible:list.summary?.visible ?? list.total,running:list.summary?.runningCount ?? 0,pending:list.summary?.pendingCount ?? 0};

  useEffect(() => {
    let cancelled = false; setSelectedWorkspace(null);
    if (workspaceId) void api.getWorkspace(workspaceId).then(item => { if (!cancelled) setSelectedWorkspace(item); }).catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId]);
  useEffect(() => {
    let cancelled = false; setSelectedRequirement(null);
    if (requirementId) void api.getRequirement(requirementId).then(item => { if (!cancelled) setSelectedRequirement(item); }).catch(() => {});
    return () => { cancelled = true; };
  }, [requirementId]);
  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key,value); else next.delete(key);
    next.delete('page'); if (key === 'workspaceId') next.delete('requirementId');
    navigate(`/workflow-runs?${next.toString()}`);
  }

  async function handleDeleteWorkflow(workflowRunId: string) {
    const confirmed = await confirm({
      description: '删除后将清空这条工作流的阶段记录、审查结果和工作副本。确认删除吗？',
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    setDeletingWorkflowId(workflowRunId);
    try {
      await api.deleteWorkflowRun(workflowRunId);
      toast.success('工作流已删除');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除工作流失败');
    } finally {
      setDeletingWorkflowId(null);
    }
  }

  function renderWorkflowRepositoryScope(run: WorkflowRun) {
    if (run.workflowRepositories.length === 0) {
      return '当前工作流没有记录仓库副本。';
    }

    const names = run.workflowRepositories.map((repository) => repository.name).join('、');
    const count = run._count?.workflowRepositories ?? run.workflowRepositories.length;
    return count > run.workflowRepositories.length ? `${names} 等 ${count} 个仓库（详情可分页查看）` : names;
  }

  return (
    <>
      <PageHeader
        eyebrow="Workflow Runs"
        title="工作流列表"
        description="从工作区、项目和需求三个维度查看流程推进情况，快速定位待确认、执行中和待人工评审的工作流。"
      />
      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard label="工作流总数" value={workflowSummary.total} />
        <MetricCard label="当前筛选结果" value={workflowSummary.visible} />
        <MetricCard label="执行中" value={workflowSummary.running} />
        <MetricCard label="待处理" value={workflowSummary.pending} />
      </div>
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader
            eyebrow="Workflow Runs"
            title="工作流列表"
          />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <ListToolbar
            filters={(
              <>
                <PagedSelect className="w-[220px]" value={workspaceId} selectedLabel={selectedWorkspace?.name} label="按工作区查看" placeholder="按工作区查看" allowClear emptyLabel="全部工作区" loadPage={query => api.getWorkspaces(query)} onValueChange={value => updateFilter('workspaceId',value)} />
                <PagedSelect className="w-[220px]" value={requirementId} selectedLabel={selectedRequirement?.title} label="按需求查看" placeholder="按需求查看" allowClear emptyLabel="全部需求" disabled={!projectId} scopeKey={`${projectId}:${workspaceId}`}
                  loadPage={async query => { const result = await api.getRequirements({...query,projectId:projectId!,workspaceId:workspaceId || undefined}); return {...result,items:result.items.map(item => ({id:item.id,name:item.title}))}; }} onValueChange={value => updateFilter('requirementId',value)} />
                <Select
                  value={runType || '__all__'}
                  onValueChange={(value) => {
                    const next = new URLSearchParams(searchParams);
                    if (value && value !== '__all__') {
                      next.set('runType', value);
                    } else {
                      next.delete('runType');
                    }
                    navigate(`/workflow-runs?${next.toString()}`);
                  }}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="按流程类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部类型</SelectItem>
                    <SelectItem value="FULL">完整研发</SelectItem>
                    <SelectItem value="BUG_FIX">缺陷修复</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}
          />
          {list.error ? <p role="alert" className="mb-3 text-sm text-danger">{list.error}<UiButton variant="outline" size="sm" onClick={refresh}>重试</UiButton></p> : null}
          {!projectId ? (
            <ProjectRequiredState />
          ) : loading && workflowRuns.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : workflowRuns.length > 0 ? (
            <div className="flex flex-col gap-3.5">
              {workflowRuns.map((item) => (
                <RecordListItem
                  key={item.id}
                  interactive
                  title={<div className="text-base font-semibold leading-6 text-foreground">{item.requirement.title}</div>}
                  badges={
                    <>
                      <Badge variant="default">{item.supersededByChangeId ? '已由需求变更替代' : formatWorkflowStatus(item.status)}</Badge>
                      {item.runType === 'BUG_FIX' ? (
                        <Badge variant="secondary">{formatWorkflowRunType(item.runType)}</Badge>
                      ) : null}
                      <Badge variant="outline">{item.aiProvider === 'cursor' ? 'Cursor CLI' : 'Codex'}</Badge>
                      <Badge variant="secondary">{item.requirement.project.name}</Badge>
                      <Badge variant="outline">{item.requirement.project.workspace.name}</Badge>
                      <Badge variant="outline">{item._count?.workflowRepositories ?? item.workflowRepositories.length} 个执行仓库</Badge>
                    </>
                  }
                  details={(
                    <>
                      <p className="text-sm leading-6 text-muted-foreground">{item.requirement.description}</p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        执行范围：{renderWorkflowRepositoryScope(item)}
                      </p>
                    </>
                  )}
                  actions={
                    <div className="flex flex-wrap gap-2">
                      <UiButton variant="outline" asChild>
                        <Link to={`/workflow-runs/${item.id}`}>查看详情</Link>
                      </UiButton>
                      <UiButton
                        variant="destructive"
                        disabled={deletingWorkflowId === item.id}
                        onClick={() => void handleDeleteWorkflow(item.id)}
                      >
                        {deletingWorkflowId === item.id ? '删除中...' : '删除工作流'}
                      </UiButton>
                    </div>
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState description="当前筛选条件下还没有工作流，可先从需求页发起流程。" />
          )}
          {projectId ? <ListPagination page={list.page} total={list.total} loading={loading} onPageChange={list.onPageChange} label="工作流列表分页" /> : null}
        </CardContent>
      </Card>
    </>
  );
}
