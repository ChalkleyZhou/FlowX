import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ContextPanel } from '../components/ContextPanel';
import { DetailHeader } from '../components/DetailHeader';
import { RequirementSchedulingPanel } from '../components/RequirementSchedulingPanel';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Spinner } from '../components/ui/spinner';
import type { Requirement } from '../types';
import { formatPlanningStatus, formatPriority } from '../utils/label-utils';

export function RequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRequirement = useCallback(async () => {
    if (!id) {
      return;
    }
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
    void fetchRequirement();
  }, [fetchRequirement]);

  useEffect(() => {
    if (window.location.hash === '#scheduling') {
      document.getElementById('scheduling')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [requirement, loading]);

  async function handleLaunchWorkflow() {
    if (!id) {
      return;
    }
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
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">需求未找到</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <DetailHeader
        eyebrow="Requirement"
        title={requirement.title}
        description={requirement.description}
        badges={[
          { key: 'project', label: requirement.project?.name ?? '', variant: 'default' },
          {
            key: 'planning',
            label: formatPlanningStatus(requirement.planningStatus),
            variant: 'outline',
          },
          {
            key: 'priority',
            label: formatPriority(requirement.priority),
            variant: 'secondary',
          },
        ]}
        actions={(
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" asChild>
              <Link to="/requirements">返回列表</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/requirements/${requirement.id}#scheduling`}>排期</Link>
            </Button>
            <Button onClick={() => void handleLaunchWorkflow()}>启动研发工作流</Button>
          </div>
        )}
      />

      <ContextPanel
        eyebrow="Requirement"
        title="需求详情"
        description="需求描述、验收标准与人员排期。"
      >
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              验收标准
            </div>
            <p className="whitespace-pre-line text-sm leading-6 text-foreground">
              {requirement.acceptanceCriteria}
            </p>
          </div>
        </div>
      </ContextPanel>

      <RequirementSchedulingPanel requirement={requirement} onChanged={fetchRequirement} />
    </div>
  );
}
