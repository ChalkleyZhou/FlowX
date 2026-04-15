import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
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
import type { Project, Requirement, WorkflowRun, Workspace } from '../types';
import { formatWorkflowStatus } from '../utils/workflow-ui';

export function WorkflowRunsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | null>(null);
  const toast = useToast();
  const workspaceId = searchParams.get('workspaceId') ?? '';
  const projectId = searchParams.get('projectId') ?? '';
  const requirementId = searchParams.get('requirementId') ?? '';

  const visibleProjects = useMemo(
    () => projects.filter((project) => !workspaceId || project.workspace.id === workspaceId),
    [projects, workspaceId],
  );
  const visibleRequirements = useMemo(
    () =>
      requirements.filter((requirement) => {
        if (workspaceId && requirement.project.workspace.id !== workspaceId) {
          return false;
        }
        if (projectId && requirement.project.id !== projectId) {
          return false;
        }
        return true;
      }),
    [projectId, requirements, workspaceId],
  );

  const filteredRuns = useMemo(
    () =>
      workflowRuns.filter((run) => {
        if (workspaceId && run.requirement.project.workspace.id !== workspaceId) {
          return false;
        }
        if (projectId && run.requirement.project.id !== projectId) {
          return false;
        }
        if (requirementId && run.requirement.id !== requirementId) {
          return false;
        }
        return true;
      }),
    [projectId, requirementId, workflowRuns, workspaceId],
  );

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
      const [workspaceList, projectList, requirementList, runList] = await Promise.all([
        api.getWorkspaces(),
        api.getProjects(),
        api.getRequirements(),
        api.getWorkflowRuns(),
      ]);
      setWorkspaces(workspaceList);
      setProjects(projectList);
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

  function renderWorkflowRepositoryScope(run: WorkflowRun) {
    if (run.workflowRepositories.length === 0) {
      return '当前工作流没有记录仓库副本。';
    }

    return run.workflowRepositories.map((repository) => repository.name).join('、');
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
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
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
                <Select
                  value={workspaceId || '__all__'}
                  onValueChange={(value) => {
                    const next = new URLSearchParams(searchParams);
                    if (value && value !== '__all__') {
                      next.set('workspaceId', value);
                      next.delete('projectId');
                      next.delete('requirementId');
                    } else {
                      next.delete('workspaceId');
                    }
                    navigate(`/workflow-runs?${next.toString()}`);
                  }}
                >
                  <SelectTrigger className="w-[220px]">
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
                  value={projectId || '__all__'}
                  onValueChange={(value) => {
                    const next = new URLSearchParams(searchParams);
                    if (value && value !== '__all__') {
                      next.set('projectId', value);
                      next.delete('requirementId');
                    } else {
                      next.delete('projectId');
                    }
                    navigate(`/workflow-runs?${next.toString()}`);
                  }}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="按项目查看" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部项目</SelectItem>
                    {visibleProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
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
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="按需求查看" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部需求</SelectItem>
                    {visibleRequirements.map((requirement) => (
                      <SelectItem key={requirement.id} value={requirement.id}>
                        {requirement.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          />
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : filteredRuns.length > 0 ? (
            <div className="flex flex-col gap-3.5">
              {filteredRuns.map((item) => (
                <RecordListItem
                  key={item.id}
                  interactive
                  title={<div className="text-base font-semibold leading-6 text-foreground">{item.requirement.title}</div>}
                  badges={
                    <>
                      <Badge variant="default">{formatWorkflowStatus(item.status)}</Badge>
                      <Badge variant="outline">{item.aiProvider === 'cursor' ? 'Cursor CLI' : 'Codex'}</Badge>
                      <Badge variant="secondary">{item.requirement.project.name}</Badge>
                      <Badge variant="outline">{item.requirement.project.workspace.name}</Badge>
                      <Badge variant="outline">{item.workflowRepositories.length} 个执行仓库</Badge>
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
        </CardContent>
      </Card>
    </>
  );
}
