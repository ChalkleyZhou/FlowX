import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ContextPanel } from '../components/ContextPanel';
import { DetailHeader } from '../components/DetailHeader';
import { IdeationBrainstormPanel } from '../components/IdeationBrainstormPanel';
import { IdeationDesignPanel } from '../components/IdeationDesignPanel';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { SectionHeading } from '../components/ui/section-heading';
import { Spinner } from '../components/ui/spinner';
import { cn } from '../lib/utils';
import type { Requirement } from '../types';

const ideationStatusLabels: Record<string, string> = {
  NONE: '未开始',
  BRAINSTORM_PENDING: '头脑风暴中',
  BRAINSTORM_WAITING_CONFIRMATION: '头脑风暴待确认',
  BRAINSTORM_CONFIRMED: '简报已确认',
  DESIGN_PENDING: '设计生成中',
  DESIGN_WAITING_CONFIRMATION: '设计待确认',
  DESIGN_CONFIRMED: '设计已确认',
  FINALIZED: '已定稿',
};

function getIdeationStatusVariant(status: string): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (status === 'FINALIZED' || status === 'DESIGN_CONFIRMED' || status === 'BRAINSTORM_CONFIRMED') return 'success';
  if (status === 'BRAINSTORM_WAITING_CONFIRMATION' || status === 'DESIGN_WAITING_CONFIRMATION') return 'warning';
  if (status === 'NONE') return 'outline';
  return 'default';
}

interface IdeationStep {
  key: string;
  label: string;
  status: 'wait' | 'process' | 'finish';
}

function getIdeationSteps(ideationStatus: string): IdeationStep[] {
  const isFinalized = ideationStatus === 'FINALIZED';
  const designActive = ['DESIGN_PENDING', 'DESIGN_WAITING_CONFIRMATION', 'DESIGN_CONFIRMED', 'FINALIZED'].includes(ideationStatus);
  const brainstormActive = ideationStatus !== 'NONE';

  return [
    {
      key: 'brainstorm',
      label: '头脑风暴',
      status: isFinalized || (brainstormActive && designActive) ? 'finish' : brainstormActive ? 'process' : 'wait',
    },
    {
      key: 'design',
      label: 'UI 设计',
      status: isFinalized ? 'finish' : designActive ? 'process' : 'wait',
    },
    {
      key: 'finalize',
      label: '定稿',
      status: isFinalized ? 'finish' : 'wait',
    },
  ];
}

function StepIndicator({ steps }: { steps: IdeationStep[] }) {
  return (
    <div className="flex items-center gap-3">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'grid h-7 w-7 place-items-center rounded-full border text-xs font-semibold transition-colors',
                step.status === 'finish' && 'border-success/40 bg-success/10 text-success',
                step.status === 'process' && 'border-primary/40 bg-primary/10 text-primary',
                step.status === 'wait' && 'border-border bg-muted text-muted-foreground',
              )}
            >
              {step.status === 'finish' ? '\u2713' : i + 1}
            </span>
            <span
              className={cn(
                'text-sm transition-colors',
                step.status === 'finish' && 'font-semibold text-success',
                step.status === 'process' && 'font-semibold text-primary',
                step.status === 'wait' && 'text-muted-foreground',
              )}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                'h-px w-6 transition-colors',
                step.status !== 'wait' ? 'bg-primary/30' : 'bg-border',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function RequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);

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

  const ideationStatus = requirement.ideationStatus || 'NONE';
  const sessions = requirement.ideationSessions ?? [];
  const canFinalize = ideationStatus === 'DESIGN_CONFIRMED';
  const isFinalized = ideationStatus === 'FINALIZED';
  const steps = getIdeationSteps(ideationStatus);
  const showDesignPanel = ['BRAINSTORM_CONFIRMED', 'DESIGN_PENDING', 'DESIGN_WAITING_CONFIRMATION', 'DESIGN_CONFIRMED', 'FINALIZED'].includes(ideationStatus);

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

      {/* Ideation Steps Indicator */}
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="p-5">
          <StepIndicator steps={steps} />
        </CardContent>
      </Card>

      {/* Brainstorm Panel */}
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="p-5">
          <IdeationBrainstormPanel
            requirementId={id!}
            ideationStatus={ideationStatus}
            sessions={sessions}
            onUpdated={fetchRequirement}
          />
        </CardContent>
      </Card>

      {/* Design Panel */}
      {showDesignPanel && (
        <Card className="border-border bg-card shadow-sm">
          <CardContent className="p-5">
            <IdeationDesignPanel
              requirementId={id!}
              ideationStatus={ideationStatus}
              sessions={sessions}
              repositories={requirement.requirementRepositories}
              onUpdated={fetchRequirement}
            />
          </CardContent>
        </Card>
      )}

      {/* Finalize */}
      {canFinalize && (
        <Card className="border-success/30 bg-success/5 shadow-sm">
          <CardHeader className="p-5">
            <SectionHeading
              eyebrow="Finalize"
              title="定稿"
              description="头脑风暴和设计方案已确认。点击定稿将产品简报内容合并到需求描述中，然后即可启动研发工作流。"
            />
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <Button onClick={handleFinalize} disabled={finalizing}>
              {finalizing ? '处理中...' : '定稿并合并到需求'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
