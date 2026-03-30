import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { FilterBar } from '../components/FilterBar';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { RecordListItem } from '../components/RecordListItem';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button as UiButton } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import type { WorkflowRun, Workspace, Requirement } from '../types';
import { formatWorkflowStatus } from '../utils/workflow-ui';

export function WorkflowRunsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | null>(null);
  const toast = useToast();
  const workspaceId = searchParams.get('workspaceId') ?? '';
  const requirementId = searchParams.get('requirementId') ?? '';

  const filteredRuns = useMemo(() => {
    return workflowRuns.filter((run) => {
      const matchWorkspace = workspaceId
        ? run.requirement.workspace?.id === workspaceId
        : true;
      const matchRequirement = requirementId ? run.requirement.id === requirementId : true;
      return matchWorkspace && matchRequirement;
    });
  }, [requirementId, workflowRuns, workspaceId]);

  const workflowSummary = useMemo(() => {
    const runningCount = workflowRuns.filter((run) => run.status === 'EXECUTION_RUNNING').length;
    const pendingCount = workflowRuns.filter((run) => run.status.includes('PENDING') || run.status.includes('WAITING')).length;
    return {
      total: workflowRuns.length,
      visible: filteredRuns.length,
      running: runningCount,
      pending: pendingCount,
    };
  }, [filteredRuns.length, workflowRuns]);

  async function refresh() {
    setLoading(true);
    try {
      const [workspaceList, requirementList, runList] = await Promise.all([
        api.getWorkspaces(),
        api.getRequirements(),
        api.getWorkflowRuns(),
      ]);
      setWorkspaces(workspaceList);
      setRequirements(requirementList);
      setWorkflowRuns(runList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载工作流失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleDeleteWorkflow(workflowRunId: string) {
    const confirmed = window.confirm('删除后将清空这条工作流的阶段记录、审查结果和工作副本。确认删除吗？');
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

  return (
    <>
      <PageHeader
        eyebrow="Workflow Runs"
        title="工作流列表"
        description="从工作区和需求维度查看流程推进情况，快速定位待确认、执行中和需要人工评审的工作流。"
      />
      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard label="工作流总数" value={workflowSummary.total} />
        <MetricCard label="当前筛选结果" value={workflowSummary.visible} />
        <MetricCard label="执行中" value={workflowSummary.running} />
        <MetricCard label="待处理" value={workflowSummary.pending} />
      </div>
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader
            eyebrow="Workflow Runs"
            title="工作流列表"
            extra={
              <FilterBar className="border-0 bg-transparent p-0">
                <Select
                  value={workspaceId || '__all__'}
                  onValueChange={(value) => {
                    const next = new URLSearchParams(searchParams);
                    if (value && value !== '__all__') {
                      next.set('workspaceId', value);
                    } else {
                      next.delete('workspaceId');
                    }
                    navigate(`/workflow-runs?${next.toString()}`);
                  }}
                >
                  <SelectTrigger className="min-w-[220px]">
                    <SelectValue placeholder="按工作区查看" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部工作区</SelectItem>
                    {workspaces.map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={requirementId || '__all__'}
                  onValueChange={(value) => {
                    const next = new URLSearchParams(searchParams);
                    if (value && value !== '__all__') {
                      next.set('requirementId', value);
                    } else {
                      next.delete('requirementId');
                    }
                    navigate(`/workflow-runs?${next.toString()}`);
                  }}
                >
                  <SelectTrigger className="min-w-[220px]">
                    <SelectValue placeholder="按需求查看" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部需求</SelectItem>
                    {requirements.map((requirement) => (
                      <SelectItem key={requirement.id} value={requirement.id}>
                        {requirement.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterBar>
            }
          />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : filteredRuns.length > 0 ? (
            <div className="record-list-stack">
            {filteredRuns.map((item) => (
              <RecordListItem
                key={item.id}
                interactive
                title={<div className="text-base font-semibold leading-6 text-slate-950">{item.requirement.title}</div>}
                badges={
                  <>
                    <Badge variant="default">
                      {formatWorkflowStatus(item.status)}
                    </Badge>
                    <Badge variant="outline">{item.requirement.workspace?.name ?? '未绑定工作区'}</Badge>
                  </>
                }
                details={<p className="text-sm leading-6 text-slate-500">{item.requirement.description}</p>}
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
        </CardContent>
      </Card>
    </>
  );
}
