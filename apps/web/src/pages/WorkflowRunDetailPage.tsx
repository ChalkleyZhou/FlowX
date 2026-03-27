import { Button, Card, Empty, Form, Input, Modal, Steps, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import { StageCard } from '../components/StageCard';
import type { WorkflowRun } from '../types';
import { formatWorkflowStatus, getStage } from '../utils/workflow-ui';

const { Title, Paragraph, Text } = Typography;

const STAGE_SEQUENCE = ['TASK_SPLIT', 'TECHNICAL_PLAN', 'EXECUTION', 'AI_REVIEW'] as const;

type WorkflowStageKey = (typeof STAGE_SEQUENCE)[number];
type EditableStage = 'task-split' | 'plan' | 'execution' | 'review';

interface StageActionView {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  variant?: 'primary' | 'default';
}

interface StageDetailView {
  title: string;
  subtitle: string;
  status?: string;
  statusMessage?: string | null;
  attempt?: number;
  output?: unknown;
  actions: StageActionView[];
}

const stageMeta: Record<
  WorkflowStageKey,
  { title: string; stepLabel: string; stageNo: string; editableStage: EditableStage }
> = {
  TASK_SPLIT: {
    title: '任务拆解',
    stepLabel: '任务拆解',
    stageNo: '阶段 2',
    editableStage: 'task-split',
  },
  TECHNICAL_PLAN: {
    title: '技术方案',
    stepLabel: '技术方案',
    stageNo: '阶段 3',
    editableStage: 'plan',
  },
  EXECUTION: {
    title: '开发执行',
    stepLabel: '开发执行',
    stageNo: '阶段 4',
    editableStage: 'execution',
  },
  AI_REVIEW: {
    title: 'AI 审查',
    stepLabel: 'AI 审查',
    stageNo: '阶段 5',
    editableStage: 'review',
  },
};

function buildWorkflowSnapshot(value: WorkflowRun | null) {
  return JSON.stringify(value);
}

function getStepVisualStatus(stageStatus?: string): 'wait' | 'process' | 'finish' | 'error' {
  switch (stageStatus) {
    case 'COMPLETED':
      return 'finish';
    case 'RUNNING':
    case 'WAITING_CONFIRMATION':
      return 'process';
    case 'FAILED':
    case 'REJECTED':
      return 'error';
    default:
      return 'wait';
  }
}

function inferFocusedStage(run: WorkflowRun): WorkflowStageKey {
  for (const stageKey of STAGE_SEQUENCE) {
    const stage = getStage(run, stageKey);
    if (stage?.status === 'RUNNING' || stage?.status === 'WAITING_CONFIRMATION' || stage?.status === 'FAILED') {
      return stageKey;
    }
  }

  if (run.status === 'PLAN_PENDING' || run.status === 'PLAN_WAITING_CONFIRMATION' || run.status === 'PLAN_CONFIRMED') {
    return 'TECHNICAL_PLAN';
  }

  if (run.status === 'EXECUTION_PENDING' || run.status === 'EXECUTION_RUNNING' || run.status === 'REVIEW_PENDING') {
    return 'EXECUTION';
  }

  if (run.status === 'HUMAN_REVIEW_PENDING' || run.status === 'DONE') {
    return 'AI_REVIEW';
  }

  return 'TASK_SPLIT';
}

export function WorkflowRunDetailPage() {
  const { workflowRunId = '' } = useParams();
  const [workflowRun, setWorkflowRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedStage, setSelectedStage] = useState<WorkflowStageKey>('TASK_SPLIT');
  const [feedbackModal, setFeedbackModal] = useState<null | { stage: EditableStage; title: string }>(null);
  const [editModal, setEditModal] = useState<null | { stage: EditableStage; title: string; initialOutput: unknown }>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [busyFindingId, setBusyFindingId] = useState<string | null>(null);
  const [feedbackForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const lastWorkflowSnapshotRef = useRef<string>('');

  async function refresh(options?: { silent?: boolean }) {
    if (!workflowRunId) {
      return;
    }

    if (!options?.silent) {
      setLoading(true);
    }

    try {
      const nextWorkflowRun = await api.getWorkflowRun(workflowRunId);
      const nextSnapshot = buildWorkflowSnapshot(nextWorkflowRun);

      if (nextSnapshot !== lastWorkflowSnapshotRef.current) {
        lastWorkflowSnapshotRef.current = nextSnapshot;
        setWorkflowRun(nextWorkflowRun);
      }
    } catch (error) {
      if (!options?.silent) {
        messageApi.error(error instanceof Error ? error.message : '加载工作流失败');
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void refresh();
  }, [workflowRunId]);

  useEffect(() => {
    if (!workflowRun) {
      return;
    }

    const suggestedStage = inferFocusedStage(workflowRun);
    const currentStage = getStage(workflowRun, selectedStage);

    if (
      !currentStage ||
      currentStage.status === 'NOT_STARTED' ||
      currentStage.status === undefined ||
      currentStage.status === 'COMPLETED'
    ) {
      setSelectedStage(suggestedStage);
    }
  }, [workflowRun]);

  const hasRunningStage = workflowRun?.stageExecutions.some((item) => item.status === 'RUNNING') ?? false;

  useEffect(() => {
    if (!hasRunningStage) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [hasRunningStage, workflowRunId]);

  async function runAction(stage: string, action: () => Promise<unknown>, successText: string) {
    if (busyStage) {
      return;
    }

    setBusyStage(stage);
    try {
      await action();
      await refresh();
      messageApi.success(successText);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusyStage(null);
    }
  }

  async function submitFeedback(values: { feedback: string }) {
    if (!workflowRun || !feedbackModal) {
      return;
    }

    setSubmitting(true);
    try {
      if (feedbackModal.stage === 'task-split') {
        await api.reviseTaskSplit(workflowRun.id, values.feedback);
      } else if (feedbackModal.stage === 'plan') {
        await api.revisePlan(workflowRun.id, values.feedback);
      } else if (feedbackModal.stage === 'execution') {
        await api.reviseExecution(workflowRun.id, values.feedback);
      } else {
        await api.reviseReview(workflowRun.id, values.feedback);
      }

      setFeedbackModal(null);
      feedbackForm.resetFields();
      await refresh();
      messageApi.success('AI 已根据意见重新处理当前阶段');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '提交意见失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitManualEdit(values: { outputText: string }) {
    if (!workflowRun || !editModal) {
      return;
    }

    setSubmitting(true);
    try {
      const output = JSON.parse(values.outputText);

      if (editModal.stage === 'task-split') {
        await api.manualEditTaskSplit(workflowRun.id, output);
      } else if (editModal.stage === 'plan') {
        await api.manualEditPlan(workflowRun.id, output);
      } else if (editModal.stage === 'execution') {
        await api.manualEditExecution(workflowRun.id, output);
      } else {
        await api.manualEditReview(workflowRun.id, output);
      }

      setEditModal(null);
      editForm.resetFields();
      await refresh();
      messageApi.success('阶段产出已人工更新');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '人工修改失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function runFindingAction(findingId: string, action: () => Promise<unknown>, successText: string) {
    if (busyFindingId) {
      return;
    }

    setBusyFindingId(findingId);
    try {
      await action();
      await refresh({ silent: true });
      messageApi.success(successText);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '处理审查条目失败');
    } finally {
      setBusyFindingId(null);
    }
  }

  const stageContent = useMemo<Record<WorkflowStageKey, StageDetailView> | null>(() => {
    if (!workflowRun) {
      return null;
    }

    const taskSplitStage = getStage(workflowRun, 'TASK_SPLIT');
    const planStage = getStage(workflowRun, 'TECHNICAL_PLAN');
    const executionStage = getStage(workflowRun, 'EXECUTION');
    const reviewStage = getStage(workflowRun, 'AI_REVIEW');

    return {
      TASK_SPLIT: {
        title: stageMeta.TASK_SPLIT.stageNo,
        subtitle: stageMeta.TASK_SPLIT.title,
        status: taskSplitStage?.status,
        statusMessage: taskSplitStage?.statusMessage,
        attempt: taskSplitStage?.attempt,
        output: taskSplitStage?.output ?? { tasks: workflowRun.tasks },
        actions: [
          {
            key: 'run',
            label: '执行任务拆解',
            onClick: () => void runAction('TASK_SPLIT', () => api.runTaskSplit(workflowRun.id), '任务拆解已启动'),
            disabled: workflowRun.status !== 'TASK_SPLIT_PENDING' || busyStage !== null,
            loading: busyStage === 'TASK_SPLIT',
            variant: 'primary' as const,
          },
          {
            key: 'confirm',
            label: '确认',
            onClick: () => void runAction('TASK_SPLIT', () => api.confirmTaskSplit(workflowRun.id), '任务拆解已确认'),
            disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION' || busyStage !== null,
            loading: busyStage === 'TASK_SPLIT',
          },
          {
            key: 'reject',
            label: '驳回',
            onClick: () => void runAction('TASK_SPLIT', () => api.rejectTaskSplit(workflowRun.id), '任务拆解已驳回'),
            disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION' || busyStage !== null,
            loading: busyStage === 'TASK_SPLIT',
            danger: true,
          },
          {
            key: 'feedback',
            label: '提意见给 AI',
            onClick: (): void => {
              setFeedbackModal({ stage: 'task-split', title: '任务拆解意见' });
            },
            disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION' || busyStage !== null,
          },
          {
            key: 'edit',
            label: '人工修改',
            onClick: (): void => {
              const output = taskSplitStage?.output ?? { tasks: workflowRun.tasks };
              editForm.setFieldsValue({ outputText: JSON.stringify(output, null, 2) });
              setEditModal({ stage: 'task-split', title: '人工修改任务拆解', initialOutput: output });
            },
            disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION' || busyStage !== null,
          },
        ],
      },
      TECHNICAL_PLAN: {
        title: stageMeta.TECHNICAL_PLAN.stageNo,
        subtitle: stageMeta.TECHNICAL_PLAN.title,
        status: planStage?.status,
        statusMessage: planStage?.statusMessage,
        attempt: planStage?.attempt,
        output: planStage?.output ?? workflowRun.plan,
        actions: [
          {
            key: 'run',
            label: '生成技术方案',
            onClick: () => void runAction('TECHNICAL_PLAN', () => api.runPlan(workflowRun.id), '技术方案生成已启动'),
            disabled: workflowRun.status !== 'PLAN_PENDING' || busyStage !== null,
            loading: busyStage === 'TECHNICAL_PLAN',
            variant: 'primary' as const,
          },
          {
            key: 'confirm',
            label: '确认',
            onClick: () => void runAction('TECHNICAL_PLAN', () => api.confirmPlan(workflowRun.id), '技术方案已确认'),
            disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION' || busyStage !== null,
            loading: busyStage === 'TECHNICAL_PLAN',
          },
          {
            key: 'reject',
            label: '驳回',
            onClick: () => void runAction('TECHNICAL_PLAN', () => api.rejectPlan(workflowRun.id), '技术方案已驳回'),
            disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION' || busyStage !== null,
            loading: busyStage === 'TECHNICAL_PLAN',
            danger: true,
          },
          {
            key: 'feedback',
            label: '提意见给 AI',
            onClick: (): void => {
              setFeedbackModal({ stage: 'plan', title: '技术方案意见' });
            },
            disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION' || busyStage !== null,
          },
          {
            key: 'edit',
            label: '人工修改',
            onClick: (): void => {
              const output = planStage?.output ?? workflowRun.plan;
              editForm.setFieldsValue({ outputText: JSON.stringify(output, null, 2) });
              setEditModal({ stage: 'plan', title: '人工修改技术方案', initialOutput: output });
            },
            disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION' || busyStage !== null,
          },
        ],
      },
      EXECUTION: {
        title: stageMeta.EXECUTION.stageNo,
        subtitle: stageMeta.EXECUTION.title,
        status: executionStage?.status,
        statusMessage: executionStage?.statusMessage,
        attempt: executionStage?.attempt,
        output: workflowRun.codeExecution,
        actions: [
          {
            key: 'run',
            label: '执行开发',
            onClick: () => void runAction('EXECUTION', () => api.runExecution(workflowRun.id), '开发执行已启动'),
            disabled: workflowRun.status !== 'EXECUTION_PENDING' || busyStage !== null,
            loading: busyStage === 'EXECUTION',
            variant: 'primary' as const,
          },
          {
            key: 'feedback',
            label: '提意见给 AI',
            onClick: (): void => {
              setFeedbackModal({ stage: 'execution', title: '开发执行意见' });
            },
            disabled: workflowRun.status !== 'REVIEW_PENDING' || busyStage !== null,
          },
          {
            key: 'edit',
            label: '人工修改',
            onClick: (): void => {
              const output = workflowRun.codeExecution;
              editForm.setFieldsValue({ outputText: JSON.stringify(output, null, 2) });
              setEditModal({ stage: 'execution', title: '人工修改开发执行结果', initialOutput: output });
            },
            disabled:
              !workflowRun.codeExecution ||
              (workflowRun.status !== 'REVIEW_PENDING' && workflowRun.status !== 'HUMAN_REVIEW_PENDING') ||
              busyStage !== null,
          },
        ],
      },
      AI_REVIEW: {
        title: stageMeta.AI_REVIEW.stageNo,
        subtitle: stageMeta.AI_REVIEW.title,
        status: reviewStage?.status,
        statusMessage: reviewStage?.statusMessage,
        attempt: reviewStage?.attempt,
        output: workflowRun.reviewReport,
        actions: [
          {
            key: 'run',
            label: '执行 AI 审查',
            onClick: () => void runAction('AI_REVIEW', () => api.runReview(workflowRun.id), 'AI 审查已启动'),
            disabled: workflowRun.status !== 'REVIEW_PENDING' || busyStage !== null,
            loading: busyStage === 'AI_REVIEW',
            variant: 'primary' as const,
          },
          {
            key: 'accept',
            label: '通过',
            onClick: () => void runAction('AI_REVIEW', () => api.decideHumanReview(workflowRun.id, 'accept'), '工作流已通过'),
            disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || busyStage !== null,
            loading: busyStage === 'AI_REVIEW',
          },
          {
            key: 'rework',
            label: '返工',
            onClick: () => void runAction('AI_REVIEW', () => api.decideHumanReview(workflowRun.id, 'rework'), '工作流已退回开发执行'),
            disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || busyStage !== null,
            loading: busyStage === 'AI_REVIEW',
          },
          {
            key: 'rollback',
            label: '回滚',
            onClick: () => void runAction('AI_REVIEW', () => api.decideHumanReview(workflowRun.id, 'rollback'), '工作流已回滚'),
            disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || busyStage !== null,
            loading: busyStage === 'AI_REVIEW',
            danger: true,
          },
          {
            key: 'feedback',
            label: '提意见给 AI',
            onClick: (): void => {
              setFeedbackModal({ stage: 'review', title: 'AI 审查意见' });
            },
            disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || busyStage !== null,
          },
          {
            key: 'edit',
            label: '人工修改',
            onClick: (): void => {
              const output = workflowRun.reviewReport;
              editForm.setFieldsValue({ outputText: JSON.stringify(output, null, 2) });
              setEditModal({ stage: 'review', title: '人工修改 AI 审查结果', initialOutput: output });
            },
            disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || busyStage !== null,
          },
        ],
      },
    };
  }, [workflowRun, busyStage]);

  if (!workflowRunId) {
    return <Navigate to="/workflow-runs" replace />;
  }

  const selectedStageContent = stageContent?.[selectedStage];
  const selectedStageIndex = STAGE_SEQUENCE.indexOf(selectedStage);
  const reviewReportId = workflowRun?.reviewReport?.id ?? null;

  return (
    <AppLayout>
      {contextHolder}
      <Modal
        title={feedbackModal?.title ?? '提交意见'}
        open={!!feedbackModal}
        footer={null}
        onCancel={() => {
          setFeedbackModal(null);
          feedbackForm.resetFields();
        }}
      >
        <Form form={feedbackForm} layout="vertical" onFinish={(values) => void submitFeedback(values)}>
          <Form.Item
            name="feedback"
            label="意见说明"
            rules={[{ required: true, message: '请输入你希望 AI 调整的意见' }]}
          >
            <Input.TextArea
              rows={6}
              placeholder="例如：任务拆解缺少数据库迁移；方案里应优先改 API；执行代码需要补测试。"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} className="accent-button">
            提交给 AI 修改
          </Button>
        </Form>
      </Modal>
      <Modal
        title={editModal?.title ?? '人工修改'}
        open={!!editModal}
        width={760}
        footer={null}
        onCancel={() => {
          setEditModal(null);
          editForm.resetFields();
        }}
      >
        <Form form={editForm} layout="vertical" onFinish={(values) => void submitManualEdit(values)}>
          <Form.Item
            name="outputText"
            label="阶段产出 JSON"
            rules={[{ required: true, message: '请输入修改后的 JSON' }]}
          >
            <Input.TextArea rows={18} spellCheck={false} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} className="accent-button">
            保存人工修改
          </Button>
        </Form>
      </Modal>
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

          <Card className="panel workflow-steps-panel" bordered={false}>
            <div className="panel-heading workflow-steps-heading">
              <div>
                <Text className="eyebrow">Workflow Steps</Text>
                <Title level={4}>按阶段查看流程与产物</Title>
              </div>
              <Text className="requirement-criteria">点击步骤切换详情，产物仅在下方显示</Text>
            </div>
            <Steps
              current={selectedStageIndex}
              responsive
              className="workflow-steps"
              onChange={(next) => setSelectedStage(STAGE_SEQUENCE[next] ?? 'TASK_SPLIT')}
              items={STAGE_SEQUENCE.map((stageKey) => {
                const stage = getStage(workflowRun, stageKey);
                return {
                  title: stageMeta[stageKey].stepLabel,
                  description: stage?.statusMessage ?? (stage?.status ? undefined : '尚未开始'),
                  status: getStepVisualStatus(stage?.status),
                };
              })}
            />
          </Card>

          <div className="workflow-detail-grid">
            <div className="workflow-detail-main">
              {selectedStageContent ? (
                <StageCard
                  title={selectedStageContent.title}
                  subtitle={selectedStageContent.subtitle}
                  status={selectedStageContent.status}
                  statusMessage={selectedStageContent.statusMessage}
                  attempt={selectedStageContent.attempt}
                  output={selectedStageContent.output}
                  actions={selectedStageContent.actions}
                />
              ) : (
                <Card className="panel empty-panel" bordered={false}>
                  <Empty description="当前阶段暂无详情" />
                </Card>
              )}

              {selectedStage === 'AI_REVIEW' ? (
                <Card className="panel" bordered={false}>
                  <div className="panel-heading workflow-steps-heading">
                    <div>
                      <Text className="eyebrow">Review Findings</Text>
                      <Title level={4}>审查条目沉淀</Title>
                    </div>
                    <Button
                      className="ghost-button"
                      onClick={() => {
                        if (!reviewReportId) {
                          return;
                        }
                        void runFindingAction(reviewReportId, () => api.syncReviewFindings(reviewReportId), '已同步审查条目');
                      }}
                      disabled={!reviewReportId || busyFindingId !== null}
                    >
                      同步 Findings
                    </Button>
                  </div>
                  {workflowRun.reviewFindings.length > 0 ? (
                    <div className="finding-list">
                      {workflowRun.reviewFindings.map((finding) => (
                        <div key={finding.id} className="finding-card">
                          <div className="finding-card-head">
                            <div>
                              <Text strong>{finding.title}</Text>
                              <div className="repo-meta-row">
                                <Tag bordered={false} color="processing">
                                  {finding.type}
                                </Tag>
                                <Tag bordered={false}>{finding.severity}</Tag>
                                <Tag bordered={false}>{finding.status}</Tag>
                              </div>
                            </div>
                          </div>
                          <Paragraph className="workflow-side-copy">{finding.description}</Paragraph>
                          {finding.impactScope && finding.impactScope.length > 0 ? (
                            <div className="workflow-side-tags">
                              {finding.impactScope.map((item) => (
                                <Tag key={item} bordered={false}>
                                  {item}
                                </Tag>
                              ))}
                            </div>
                          ) : null}
                          <div className="stage-action-row">
                            <Button
                              className="ghost-button"
                              onClick={() => void runFindingAction(finding.id, () => api.acceptReviewFinding(finding.id), '审查条目已接受')}
                              loading={busyFindingId === finding.id}
                              disabled={busyFindingId !== null || finding.status === 'CONVERTED_TO_ISSUE' || finding.status === 'CONVERTED_TO_BUG'}
                            >
                              接受
                            </Button>
                            <Button
                              className="ghost-button"
                              onClick={() => void runFindingAction(finding.id, () => api.dismissReviewFinding(finding.id), '审查条目已忽略')}
                              loading={busyFindingId === finding.id}
                              disabled={busyFindingId !== null || !!finding.convertedIssueId || !!finding.convertedBugId}
                            >
                              忽略
                            </Button>
                            <Button
                              className="ghost-button"
                              onClick={() =>
                                void runFindingAction(finding.id, () => api.convertReviewFindingToIssue(finding.id), '已录入为 Issue')
                              }
                              loading={busyFindingId === finding.id}
                              disabled={busyFindingId !== null || !!finding.convertedIssueId || !!finding.convertedBugId}
                            >
                              转 Issue
                            </Button>
                            <Button
                              type="primary"
                              className="accent-button"
                              onClick={() =>
                                void runFindingAction(finding.id, () => api.convertReviewFindingToBug(finding.id), '已录入为 Bug')
                              }
                              loading={busyFindingId === finding.id}
                              disabled={busyFindingId !== null || !!finding.convertedIssueId || !!finding.convertedBugId}
                            >
                              转 Bug
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty description="还没有沉淀的审查条目，先同步 findings。" />
                  )}
                </Card>
              ) : null}
            </div>

            <div className="workflow-detail-side">
              <Card className="panel" bordered={false}>
                <div className="panel-heading">
                  <Text className="eyebrow">Stage Focus</Text>
                  <Title level={4}>{stageMeta[selectedStage].title}</Title>
                </div>
                <Paragraph className="workflow-side-copy">
                  当前展示的是所选阶段的结构化产出和可执行操作。上方步骤条反映全流程进度，等待确认和执行中的阶段会优先高亮。
                </Paragraph>
                <div className="workflow-side-tags">
                  <Tag bordered={false} color="processing">
                    当前步骤 {selectedStageIndex + 1}/{STAGE_SEQUENCE.length}
                  </Tag>
                  {hasRunningStage ? (
                    <Tag bordered={false} color="gold">
                      后台处理中
                    </Tag>
                  ) : null}
                </div>
              </Card>

              {workflowRun.workflowRepositories.length > 0 ? (
                <Card className="panel" bordered={false}>
                  <div className="panel-heading">
                    <Text className="eyebrow">Workflow Branches</Text>
                    <Title level={4}>本次工作流使用的代码分支</Title>
                  </div>
                  <div className="repo-list">
                    {workflowRun.workflowRepositories.map((repository) => (
                      <div key={repository.id} className="repo-row">
                        <div>
                          <Text strong>{repository.name}</Text>
                          <div className="repo-meta-row">
                            <Tag bordered={false}>基线分支 {repository.baseBranch}</Tag>
                            <Tag bordered={false} color="processing">
                              工作分支 {repository.workingBranch}
                            </Tag>
                            <Tag
                              bordered={false}
                              color={
                                repository.status === 'READY'
                                  ? 'success'
                                  : repository.status === 'ERROR'
                                    ? 'error'
                                    : 'gold'
                              }
                            >
                              {repository.status}
                            </Tag>
                          </div>
                          <Text className="requirement-criteria">{repository.localPath ?? '未绑定本地路径'}</Text>
                          {repository.syncError ? (
                            <Text type="danger" className="requirement-criteria">
                              分支准备失败：{repository.syncError}
                            </Text>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ) : null}
            </div>
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
