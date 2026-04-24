import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ContextPanel } from '../components/ContextPanel';
import { DetailHeader } from '../components/DetailHeader';
import { IdeationBrainstormPanel } from '../components/IdeationBrainstormPanel';
import { IdeationDesignPanel } from '../components/IdeationDesignPanel';
import { MetricCard } from '../components/MetricCard';
import { SectionHeader } from '../components/SectionHeader';
import { WorkflowSteps } from '../components/WorkflowSteps';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { SectionHeading } from '../components/ui/section-heading';
import { Spinner } from '../components/ui/spinner';
import type { Requirement } from '../types';

const ideationStatusLabels: Record<string, string> = {
  NONE: '未开始',
  BRAINSTORM_PENDING: '头脑风暴中',
  BRAINSTORM_WAITING_CONFIRMATION: '头脑风暴待确认',
  BRAINSTORM_CONFIRMED: '简报已确认',
  DESIGN_PENDING: '设计生成中',
  DESIGN_WAITING_CONFIRMATION: '设计待确认',
  DESIGN_CONFIRMED: '设计已确认',
  DEMO_PENDING: 'Demo 生成中',
  DEMO_WAITING_CONFIRMATION: 'Demo 待确认',
  DEMO_CONFIRMED: 'Demo 已确认',
  FINALIZED: '已定稿',
};

const sessionStatusLabels: Record<string, string> = {
  NOT_STARTED: '未开始',
  PENDING: '待执行',
  RUNNING: '执行中',
  WAITING_CONFIRMATION: '待确认',
  COMPLETED: '已完成',
  FAILED: '失败',
  REJECTED: '已驳回',
};

function getIdeationStatusVariant(status: string): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (status === 'FINALIZED' || status === 'DEMO_CONFIRMED' || status === 'DESIGN_CONFIRMED' || status === 'BRAINSTORM_CONFIRMED') return 'success';
  if (status === 'BRAINSTORM_WAITING_CONFIRMATION' || status === 'DESIGN_WAITING_CONFIRMATION' || status === 'DEMO_WAITING_CONFIRMATION') return 'warning';
  if (status === 'NONE') return 'outline';
  return 'default';
}

function getSessionStatusVariant(status?: string): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (!status || status === 'NOT_STARTED') return 'outline';
  if (status === 'FAILED' || status === 'REJECTED') return 'destructive';
  if (status === 'WAITING_CONFIRMATION') return 'warning';
  if (status === 'COMPLETED') return 'success';
  return 'default';
}

interface IdeationStep {
  key: string;
  label: string;
  status: 'wait' | 'process' | 'finish';
}

function getIdeationSteps(ideationStatus: string): IdeationStep[] {
  const isFinalized = ideationStatus === 'FINALIZED';
  const brainstormDone = ['BRAINSTORM_CONFIRMED', 'DESIGN_PENDING', 'DESIGN_WAITING_CONFIRMATION', 'DESIGN_CONFIRMED', 'DEMO_PENDING', 'DEMO_WAITING_CONFIRMATION', 'DEMO_CONFIRMED', 'FINALIZED'].includes(ideationStatus);
  const brainstormActive = ideationStatus !== 'NONE' && !brainstormDone;
  const designActive = ['BRAINSTORM_CONFIRMED', 'DESIGN_PENDING', 'DESIGN_WAITING_CONFIRMATION'].includes(ideationStatus);
  const designDone = ['DESIGN_CONFIRMED', 'DEMO_PENDING', 'DEMO_WAITING_CONFIRMATION', 'DEMO_CONFIRMED', 'FINALIZED'].includes(ideationStatus);

  return [
    {
      key: 'brainstorm',
      label: '头脑风暴',
      status: isFinalized || brainstormDone ? 'finish' : brainstormActive ? 'process' : 'wait',
    },
    {
      key: 'design',
      label: 'UI 设计',
      status: isFinalized || designDone ? 'finish' : designActive ? 'process' : 'wait',
    },
    {
      key: 'finalize',
      label: '定稿',
      status: isFinalized ? 'finish' : 'wait',
    },
  ];
}

function getIdeationStepDescription(stepKey: string, ideationStatus: string) {
  if (stepKey === 'brainstorm') {
    if (ideationStatus === 'NONE') return '尚未开始';
    if (ideationStatus === 'BRAINSTORM_PENDING') return 'AI 正在生成产品简报';
    if (ideationStatus === 'BRAINSTORM_WAITING_CONFIRMATION') return '等待你确认简报';
    return '已完成';
  }
  if (stepKey === 'design') {
    if (['NONE', 'BRAINSTORM_PENDING', 'BRAINSTORM_WAITING_CONFIRMATION'].includes(ideationStatus)) return '等待头脑风暴确认';
    if (ideationStatus === 'DESIGN_PENDING') return 'AI 正在生成设计稿';
    if (ideationStatus === 'DESIGN_WAITING_CONFIRMATION') return '等待你确认设计';
    return ['DESIGN_CONFIRMED', 'DEMO_PENDING', 'DEMO_WAITING_CONFIRMATION', 'DEMO_CONFIRMED', 'FINALIZED'].includes(ideationStatus) ? '已完成' : '尚未开始';
  }
  if (stepKey === 'finalize') {
    if (ideationStatus === 'FINALIZED') return '已完成';
    if (ideationStatus === 'DEMO_CONFIRMED') return '可执行定稿';
    return '等待 Demo 确认';
  }
  return '尚未开始';
}

export function RequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [selectedIdeationStage, setSelectedIdeationStage] = useState<'brainstorm' | 'design' | 'finalize'>('brainstorm');
  const ideationStatus = (requirement?.ideationStatus || 'NONE').trim().toUpperCase();
  const activeIdeationStage: 'brainstorm' | 'design' | 'finalize' =
    ideationStatus === 'FINALIZED' || ideationStatus === 'DEMO_CONFIRMED'
      ? 'finalize'
      : ['BRAINSTORM_CONFIRMED', 'DESIGN_PENDING', 'DESIGN_WAITING_CONFIRMATION', 'DESIGN_CONFIRMED', 'DEMO_PENDING', 'DEMO_WAITING_CONFIRMATION'].includes(ideationStatus)
        ? 'design'
        : 'brainstorm';

  const fetchRequirement = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getRequirement(id);
      setRequirement(data);
    } catch (err) {
      console.error('Failed to fetch requirement:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchRequirement();
  }, [fetchRequirement]);

  useEffect(() => {
    setSelectedIdeationStage(activeIdeationStage);
  }, [id, activeIdeationStage]);

  // Auto-refresh when ideation session is running
  useEffect(() => {
    if (!requirement) return;

    const hasRunningSession = requirement.ideationSessions?.some(
      (s) => s.status === 'RUNNING',
    );
    if (!hasRunningSession) return;

    const interval = setInterval(fetchRequirement, 2500);
    return () => clearInterval(interval);
  }, [requirement, fetchRequirement]);

  async function handleFinalize() {
    if (!id) return;
    setFinalizing(true);
    try {
      await api.finalizeIdeation(id);
      await fetchRequirement();
    } catch (err) {
      alert(err instanceof Error ? err.message : '定稿失败');
    } finally {
      setFinalizing(false);
    }
  }

  async function handleLaunchWorkflow() {
    if (!id) return;
    try {
      const workflow = await api.createWorkflowRun(id);
      navigate(`/workflow-runs/${workflow.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '启动工作流失败');
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (!requirement) {
    return (
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">需求未找到</p>
        </CardContent>
      </Card>
    );
  }

  const sessions = requirement.ideationSessions ?? [];
  const canFinalize = ideationStatus === 'DEMO_CONFIRMED';
  const isFinalized = ideationStatus === 'FINALIZED';
  const steps = getIdeationSteps(ideationStatus);
  const brainstormLatestSession = sessions
    .filter((session) => session.stage === 'BRAINSTORM')
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  const designLatestSession = sessions
    .filter((session) => session.stage === 'DESIGN')
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  const demoLatestSession = sessions
    .filter((session) => session.stage === 'DEMO')
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  const latestSessions = [brainstormLatestSession, designLatestSession, demoLatestSession].filter(
    (session): session is NonNullable<typeof session> => Boolean(session),
  );
  const ideationRepositories =
    requirement.requirementRepositories && requirement.requirementRepositories.length > 0
      ? requirement.requirementRepositories
      : (requirement.project?.workspace?.repositories ?? []).map((repository) => ({
          id: `workspace-fallback-${repository.id}`,
          repository,
        }));
  const runningCount = latestSessions.filter((session) => session.status === 'RUNNING').length;
  const waitingCount = latestSessions.filter((session) => session.status === 'WAITING_CONFIRMATION').length;
  const completedCount = latestSessions.filter((session) => session.status === 'COMPLETED').length;
  const selectedStepIndex =
    selectedIdeationStage === 'brainstorm' ? 0 : selectedIdeationStage === 'design' ? 1 : 2;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <DetailHeader
        eyebrow="Requirement Ideation"
        title={requirement.title}
        description={requirement.description}
        badges={[
          { key: 'project', label: requirement.project?.name ?? '', variant: 'default' },
          { key: 'ideation', label: ideationStatusLabels[ideationStatus] ?? ideationStatus, variant: getIdeationStatusVariant(ideationStatus) },
        ]}
        actions={
          <div className="flex items-center gap-3">
            <Button variant="outline" asChild>
              <Link to="/requirements">返回列表</Link>
            </Button>
            {isFinalized && (
              <Button onClick={handleLaunchWorkflow}>启动研发工作流</Button>
            )}
          </div>
        }
      />

      {/* Requirement info */}
      <ContextPanel
        eyebrow="Requirement"
        title="需求详情"
        description="原始需求描述和验收标准。定稿后，产品简报内容将合并到需求描述中。"
      >
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">验收标准</div>
            <p className="whitespace-pre-line text-sm leading-6 text-foreground">{requirement.acceptanceCriteria}</p>
          </div>
        </div>
      </ContextPanel>

      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard label="当前状态" value={ideationStatusLabels[ideationStatus] ?? ideationStatus} helpText="构思流程总体状态。" />
        <MetricCard
          label="步骤进度"
          value={`${activeIdeationStage === 'finalize' ? 3 : activeIdeationStage === 'design' ? 2 : 1}/3`}
          helpText="头脑风暴、UI 设计、定稿。"
        />
        <MetricCard label="待确认" value={waitingCount} helpText="等待人工确认的轮次。" />
        <MetricCard label="已完成轮次" value={completedCount} helpText={runningCount > 0 ? `当前还有 ${runningCount} 个轮次执行中。` : '当前没有运行中的轮次。'} />
      </div>

      <Card className="rounded-md border-border bg-card shadow-sm">
        <CardHeader className="p-5 pb-0">
          <SectionHeader
            eyebrow="Ideation Steps"
            title="按阶段推进构思"
            description="先确认产品简报，再确认 UI 设计，最后定稿进入研发工作流。"
          />
        </CardHeader>
        <CardContent className="p-5 pt-4">
          <WorkflowSteps
            current={selectedStepIndex}
            onChange={(next) => {
              if (next === 0) {
                setSelectedIdeationStage('brainstorm');
              } else if (next === 1) {
                setSelectedIdeationStage('design');
              } else {
                setSelectedIdeationStage('finalize');
              }
            }}
            items={steps.map((step) => ({
              key: step.key,
              title: step.label,
              description: getIdeationStepDescription(step.key, ideationStatus),
              status: step.status,
            }))}
          />
        </CardContent>
      </Card>

      {/* Brainstorm Panel */}
      {selectedIdeationStage === 'brainstorm' && (
        <Card className="rounded-md border-border bg-card shadow-sm">
          <CardHeader className="p-5 pb-0">
            <SectionHeader
              eyebrow="Stage 1"
              title="头脑风暴"
              description="围绕用户价值与场景，产出可确认的产品简报。"
              extra={
                <Badge
                  variant={getSessionStatusVariant(brainstormLatestSession?.status)}
                >
                  {sessionStatusLabels[brainstormLatestSession?.status ?? 'NOT_STARTED'] ?? '未开始'}
                </Badge>
              }
            />
          </CardHeader>
          <CardContent className="p-5 pt-4">
            <IdeationBrainstormPanel
              requirementId={id!}
              ideationStatus={ideationStatus}
              sessions={sessions}
              onUpdated={fetchRequirement}
              hideHeader
            />
          </CardContent>
        </Card>
      )}

      {/* Design Panel */}
      {selectedIdeationStage === 'design' && (
        <Card className="rounded-md border-border bg-card shadow-sm">
          <CardHeader className="p-5 pb-0">
            <SectionHeader
              eyebrow="Stage 2"
              title="UI 设计与本地预览"
              description="生成设计方案与 Demo 页面，并在本地开发环境快速验证。"
              extra={
                <Badge
                  variant={getSessionStatusVariant(designLatestSession?.status)}
                >
                  {sessionStatusLabels[designLatestSession?.status ?? 'NOT_STARTED'] ?? '未开始'}
                </Badge>
              }
            />
          </CardHeader>
          <CardContent className="p-5 pt-4">
            {['BRAINSTORM_CONFIRMED', 'DESIGN_PENDING', 'DESIGN_WAITING_CONFIRMATION', 'DESIGN_CONFIRMED', 'DEMO_PENDING', 'DEMO_WAITING_CONFIRMATION', 'DEMO_CONFIRMED', 'FINALIZED'].includes(ideationStatus) ? (
              <IdeationDesignPanel
                requirementId={id!}
                ideationStatus={ideationStatus}
                sessions={sessions}
                repositories={ideationRepositories}
                onUpdated={fetchRequirement}
                hideHeader
              />
            ) : (
              <p className="text-sm text-muted-foreground">请先完成头脑风暴确认，再进入 UI 设计阶段。</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Finalize */}
      {selectedIdeationStage === 'finalize' && (
        <Card className="border-success/30 bg-success/5 shadow-sm">
          <CardHeader className="p-5">
            <SectionHeading
              eyebrow="Finalize"
              title={isFinalized ? '定稿已完成' : '定稿'}
              description={
                isFinalized
                  ? '当前需求已完成构思定稿，可直接进入研发工作流。'
                  : '头脑风暴和设计方案已确认。点击定稿将产品简报内容合并到需求描述中，然后即可启动研发工作流。'
              }
            />
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {canFinalize ? (
              <Button onClick={handleFinalize} disabled={finalizing}>
                {finalizing ? '处理中...' : '定稿并合并到需求'}
              </Button>
            ) : ideationStatus === 'FINALIZED' ? (
              <p className="text-sm text-success">已定稿，返回顶部可启动研发工作流。</p>
            ) : (
              <p className="text-sm text-muted-foreground">请先完成 UI 设计确认，再执行定稿。</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
