import { Button, Card, Empty, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import { StageCard } from '../components/StageCard';
import type { WorkflowRun } from '../types';
import { formatWorkflowStatus, getStage } from '../utils/workflow-ui';

const { Title, Paragraph, Text } = Typography;

export function WorkflowRunDetailPage() {
  const { workflowRunId = '' } = useParams();
  const [workflowRun, setWorkflowRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  async function refresh() {
    if (!workflowRunId) {
      return;
    }
    setLoading(true);
    try {
      setWorkflowRun(await api.getWorkflowRun(workflowRunId));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载工作流失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [workflowRunId]);

  async function runAction(action: () => Promise<unknown>, successText: string) {
    try {
      await action();
      await refresh();
      messageApi.success(successText);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '操作失败');
    }
  }

  if (!workflowRunId) {
    return <Navigate to="/workflow-runs" replace />;
  }

  return (
    <AppLayout>
      {contextHolder}
      {workflowRun ? (
        <div className="workflow-detail-stack">
          <Card className="panel workflow-banner" bordered={false} loading={loading}>
            <div className="workflow-banner-copy">
              <Text className="eyebrow">Workflow Detail</Text>
              <Title level={3}>{workflowRun.requirement.title}</Title>
              <Paragraph>{workflowRun.requirement.description}</Paragraph>
              <div className="workspace-meta-row">
                <Tag bordered={false} color="processing">
                  {workflowRun.requirement.workspace?.name ?? '未绑定工作区'}
                </Tag>
                <Tag bordered={false}>{workflowRun.id}</Tag>
              </div>
            </div>
            <div className="workflow-banner-side">
              <Tag className="status-pill" bordered={false}>
                {formatWorkflowStatus(workflowRun.status)}
              </Tag>
              <Text className="workflow-criteria">{workflowRun.requirement.acceptanceCriteria}</Text>
              <Link className="ant-btn ghost-button" to="/workflow-runs">
                返回列表
              </Link>
            </div>
          </Card>

          <div className="stage-grid">
            <StageCard
              title="阶段 2"
              subtitle="任务拆解"
              status={getStage(workflowRun, 'TASK_SPLIT')?.status}
              attempt={getStage(workflowRun, 'TASK_SPLIT')?.attempt}
              output={getStage(workflowRun, 'TASK_SPLIT')?.output ?? { tasks: workflowRun.tasks }}
              actions={[
                {
                  key: 'run',
                  label: '执行任务拆解',
                  onClick: () => void runAction(() => api.runTaskSplit(workflowRun.id), '任务拆解完成'),
                  disabled: workflowRun.status !== 'TASK_SPLIT_PENDING',
                  variant: 'primary',
                },
                {
                  key: 'confirm',
                  label: '确认',
                  onClick: () => void runAction(() => api.confirmTaskSplit(workflowRun.id), '任务拆解已确认'),
                  disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION',
                },
                {
                  key: 'reject',
                  label: '驳回',
                  onClick: () => void runAction(() => api.rejectTaskSplit(workflowRun.id), '任务拆解已驳回'),
                  disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION',
                  danger: true,
                },
              ]}
            />
            <StageCard
              title="阶段 3"
              subtitle="技术方案"
              status={getStage(workflowRun, 'TECHNICAL_PLAN')?.status}
              attempt={getStage(workflowRun, 'TECHNICAL_PLAN')?.attempt}
              output={getStage(workflowRun, 'TECHNICAL_PLAN')?.output ?? workflowRun.plan}
              actions={[
                {
                  key: 'run',
                  label: '生成技术方案',
                  onClick: () => void runAction(() => api.runPlan(workflowRun.id), '技术方案已生成'),
                  disabled: workflowRun.status !== 'PLAN_PENDING',
                  variant: 'primary',
                },
                {
                  key: 'confirm',
                  label: '确认',
                  onClick: () => void runAction(() => api.confirmPlan(workflowRun.id), '技术方案已确认'),
                  disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION',
                },
                {
                  key: 'reject',
                  label: '驳回',
                  onClick: () => void runAction(() => api.rejectPlan(workflowRun.id), '技术方案已驳回'),
                  disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION',
                  danger: true,
                },
              ]}
            />
            <StageCard
              title="阶段 4"
              subtitle="开发执行"
              status={getStage(workflowRun, 'EXECUTION')?.status}
              attempt={getStage(workflowRun, 'EXECUTION')?.attempt}
              output={workflowRun.codeExecution}
              actions={[
                {
                  key: 'run',
                  label: '执行开发',
                  onClick: () => void runAction(() => api.runExecution(workflowRun.id), '开发执行完成'),
                  disabled: workflowRun.status !== 'EXECUTION_PENDING',
                  variant: 'primary',
                },
              ]}
            />
            <StageCard
              title="阶段 5"
              subtitle="AI 审查"
              status={getStage(workflowRun, 'AI_REVIEW')?.status}
              attempt={getStage(workflowRun, 'AI_REVIEW')?.attempt}
              output={workflowRun.reviewReport}
              actions={[
                {
                  key: 'run',
                  label: '执行 AI 审查',
                  onClick: () => void runAction(() => api.runReview(workflowRun.id), 'AI 审查完成'),
                  disabled: workflowRun.status !== 'REVIEW_PENDING',
                  variant: 'primary',
                },
                {
                  key: 'accept',
                  label: '通过',
                  onClick: () => void runAction(() => api.decideHumanReview(workflowRun.id, 'accept'), '工作流已通过'),
                  disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING',
                },
                {
                  key: 'rework',
                  label: '返工',
                  onClick: () => void runAction(() => api.decideHumanReview(workflowRun.id, 'rework'), '工作流已退回开发执行'),
                  disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING',
                },
                {
                  key: 'rollback',
                  label: '回滚',
                  onClick: () => void runAction(() => api.decideHumanReview(workflowRun.id, 'rollback'), '工作流已回滚'),
                  disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING',
                  danger: true,
                },
              ]}
            />
          </div>
        </div>
      ) : (
        <Card className="panel empty-panel" bordered={false} loading={loading}>
          <Empty description="未找到工作流" />
        </Card>
      )}
    </AppLayout>
  );
}
