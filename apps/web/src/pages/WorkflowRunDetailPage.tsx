import { Button, Card, Empty, Form, Input, Modal, Steps, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import { ContextCard } from '../components/ContextCard';
import { DetailBanner } from '../components/DetailBanner';
import { SectionHeader } from '../components/SectionHeader';
import { StageCard } from '../components/StageCard';
import { SummaryMetrics } from '../components/SummaryMetrics';
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

interface DiffArtifactView {
  repository: string;
  branch: string;
  localPath: string;
  diffStat: string;
  diffText: string;
  untrackedFiles: string[];
}

interface DiffFileView {
  key: string;
  path: string;
  kind: 'modified' | 'untracked';
  diffText: string;
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

function splitDiffTextIntoFiles(diffText: string): DiffFileView[] {
  if (!diffText.trim()) {
    return [];
  }

  const chunks = diffText
    .split(/(?=^diff --git )/gm)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk, index) => {
    const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const path = header?.[2] ?? header?.[1] ?? `变更文件 ${index + 1}`;

    return {
      key: `modified-${path}-${index}`,
      path,
      kind: 'modified' as const,
      diffText: chunk,
    };
  });
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
  const [selectedArtifactKey, setSelectedArtifactKey] = useState<string | null>(null);
  const [selectedDiffFileKey, setSelectedDiffFileKey] = useState<string | null>(null);
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
  const diffArtifacts = useMemo<DiffArtifactView[]>(
    () => ((workflowRun?.codeExecution?.diffArtifacts as DiffArtifactView[] | undefined) ?? []).filter(Boolean),
    [workflowRun],
  );
  const diffReviewData = useMemo(() => {
    return diffArtifacts.map((artifact, artifactIndex) => {
      const modifiedFiles = splitDiffTextIntoFiles(artifact.diffText);
      const untrackedFiles = (artifact.untrackedFiles ?? []).map((path, untrackedIndex) => ({
        key: `untracked-${path}-${untrackedIndex}`,
        path,
        kind: 'untracked' as const,
        diffText: `未跟踪文件\n\n${path}\n\n该文件尚未纳入 Git 版本控制，请在人工审查时确认是否需要保留。`,
      }));

      return {
        artifactKey: `${artifact.repository}-${artifact.branch}-${artifactIndex}`,
        ...artifact,
        files: [...modifiedFiles, ...untrackedFiles],
      };
    });
  }, [diffArtifacts]);
  const activeArtifact = useMemo(() => {
    return (
      diffReviewData.find((artifact) => artifact.artifactKey === selectedArtifactKey) ??
      diffReviewData[0] ??
      null
    );
  }, [diffReviewData, selectedArtifactKey]);
  const activeDiffFile = useMemo(() => {
    if (!activeArtifact) {
      return null;
    }

    return activeArtifact.files.find((item) => item.key === selectedDiffFileKey) ?? activeArtifact.files[0] ?? null;
  }, [activeArtifact, selectedDiffFileKey]);
  const workflowMetrics = useMemo(() => {
    if (!workflowRun) {
      return null;
    }

    const completedStages = workflowRun.stageExecutions.filter((item) => item.status === 'COMPLETED').length;
    const waitingStages = workflowRun.stageExecutions.filter((item) => item.status === 'WAITING_CONFIRMATION').length;
    const findingsCount = workflowRun.reviewFindings.length;

    return {
      completedStages,
      waitingStages,
      findingsCount,
      repositoryCount: workflowRun.workflowRepositories.length,
    };
  }, [workflowRun]);

  useEffect(() => {
    if (!hasRunningStage) {
      return;
    }

    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [hasRunningStage, workflowRunId]);

  useEffect(() => {
    if (!activeArtifact) {
      setSelectedArtifactKey(null);
      setSelectedDiffFileKey(null);
      return;
    }

    if (selectedArtifactKey !== activeArtifact.artifactKey) {
      setSelectedArtifactKey(activeArtifact.artifactKey);
    }

    if (!activeDiffFile && activeArtifact.files[0]) {
      setSelectedDiffFileKey(activeArtifact.files[0].key);
      return;
    }

    if (activeDiffFile && selectedDiffFileKey !== activeDiffFile.key) {
      setSelectedDiffFileKey(activeDiffFile.key);
    }
  }, [activeArtifact, activeDiffFile, selectedArtifactKey, selectedDiffFileKey]);

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
          <DetailBanner
            eyebrow="Workflow Detail"
            title={workflowRun.requirement.title}
            description={workflowRun.requirement.description}
            loading={loading}
            tags={
              <>
                <Tag bordered={false} color="processing">
                  {workflowRun.requirement.workspace?.name ?? '未绑定工作区'}
                </Tag>
                <Tag bordered={false}>{workflowRun.id}</Tag>
              </>
            }
            actions={
              <>
                <Tag className="status-pill" bordered={false}>
                  {formatWorkflowStatus(workflowRun.status)}
                </Tag>
                <Text className="workflow-criteria">{workflowRun.requirement.acceptanceCriteria}</Text>
                <Link className="ant-btn ghost-button" to="/workflow-runs">
                  返回列表
                </Link>
              </>
            }
          />

          {workflowMetrics ? (
            <SummaryMetrics
              className="workflow-summary-grid"
              items={[
                {
                  key: 'status',
                  label: '当前状态',
                  value: formatWorkflowStatus(workflowRun.status),
                  helpText: hasRunningStage ? '当前有阶段正在后台执行。' : '当前没有后台执行中的阶段。',
                },
                {
                  key: 'progress',
                  label: '阶段进度',
                  value: `${workflowMetrics.completedStages}/${STAGE_SEQUENCE.length}`,
                  helpText: '已完成阶段数，按任务拆解到 AI 审查统计。',
                },
                {
                  key: 'waiting',
                  label: '待人工处理',
                  value: workflowMetrics.waitingStages,
                  helpText: '等待人工确认或下一步决策的阶段数量。',
                },
                {
                  key: 'repos',
                  label: '代码上下文',
                  value: workflowMetrics.repositoryCount,
                  helpText:
                    workflowMetrics.findingsCount > 0
                      ? `已沉淀 ${workflowMetrics.findingsCount} 条审查条目。`
                      : '当前还没有沉淀的审查条目。',
                },
              ]}
            />
          ) : null}

          <Card className="panel workflow-steps-panel" bordered={false}>
            <SectionHeader
              eyebrow="Workflow Steps"
              title="按阶段查看流程与产物"
              className="workflow-steps-heading"
              extra={<Text className="requirement-criteria">点击步骤切换详情，产物仅在下方显示</Text>}
            />
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

          <div className="workflow-detail-main">
            {selectedStageContent ? (
              <StageCard
                title={selectedStageContent.title}
                subtitle={selectedStageContent.subtitle}
                status={selectedStageContent.status}
                statusMessage={selectedStageContent.statusMessage}
                attempt={selectedStageContent.attempt}
                metaItems={[
                  { key: 'step', label: '当前步骤', value: `${selectedStageIndex + 1}/${STAGE_SEQUENCE.length}` },
                  {
                    key: 'focus-status',
                    label: '阶段状态',
                    value: (
                      <Tag bordered={false} color={hasRunningStage ? 'gold' : 'processing'}>
                        {hasRunningStage ? '后台处理中' : selectedStageContent.status ?? '未开始'}
                      </Tag>
                    ),
                  },
                ]}
                output={selectedStageContent.output}
                actions={selectedStageContent.actions}
              />
            ) : (
              <Card className="panel empty-panel" bordered={false}>
                <Empty description="当前阶段暂无详情" />
              </Card>
            )}

            <div className="workflow-context-grid">
              {workflowRun.workflowRepositories.length > 0 ? (
                <ContextCard eyebrow="Workflow Branches" title="本次工作流使用的代码分支">
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
                </ContextCard>
              ) : null}
            </div>

            {diffReviewData.length > 0 ? (
              <Card className="panel diff-review-panel" bordered={false}>
                <div className="diff-review-header">
                  <SectionHeader
                    eyebrow="Diff Review"
                    title="代码变更审查"
                    description="先确认变更范围，再逐文件查看真实差异，最后结合 AI 审查结果做人工判断。"
                  />
                  <div className="diff-review-summary">
                    <div className="diff-summary-pill">
                      <Text className="summary-label">变更仓库</Text>
                      <Text strong>{diffReviewData.length}</Text>
                    </div>
                    <div className="diff-summary-pill">
                      <Text className="summary-label">变更文件</Text>
                      <Text strong>
                        {diffReviewData.reduce((total, artifact) => total + artifact.files.length, 0)}
                      </Text>
                    </div>
                    <div className="diff-summary-pill">
                      <Text className="summary-label">未跟踪文件</Text>
                      <Text strong>
                        {diffReviewData.reduce((total, artifact) => total + artifact.untrackedFiles.length, 0)}
                      </Text>
                    </div>
                  </div>
                </div>

                <div className="diff-artifact-switcher">
                  {diffReviewData.map((artifact) => (
                    <button
                      key={artifact.artifactKey}
                      type="button"
                      className={[
                        'diff-artifact-button',
                        artifact.artifactKey === activeArtifact?.artifactKey ? 'diff-artifact-button-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => {
                        setSelectedArtifactKey(artifact.artifactKey);
                        setSelectedDiffFileKey(artifact.files[0]?.key ?? null);
                      }}
                    >
                      <span className="diff-artifact-title">{artifact.repository}</span>
                      <span className="diff-artifact-meta">{artifact.branch}</span>
                    </button>
                  ))}
                </div>

                {activeArtifact ? (
                  <div className="diff-review-layout">
                    <div className="diff-file-list">
                      <div className="diff-review-subhead">
                        <Text strong>变更文件</Text>
                        <Text className="requirement-criteria">
                          {activeArtifact.files.length} 个文件
                        </Text>
                      </div>
                      {activeArtifact.diffStat ? (
                        <pre className="diff-stat-box">{activeArtifact.diffStat}</pre>
                      ) : null}
                      <div className="diff-file-list-body">
                        {activeArtifact.files.map((file) => (
                          <button
                            key={file.key}
                            type="button"
                            className={[
                              'diff-file-button',
                              file.key === activeDiffFile?.key ? 'diff-file-button-active' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={() => setSelectedDiffFileKey(file.key)}
                          >
                            <span className="diff-file-path">{file.path}</span>
                            <Tag
                              bordered={false}
                              color={file.kind === 'untracked' ? 'gold' : 'processing'}
                              className="diff-file-kind"
                            >
                              {file.kind === 'untracked' ? '未跟踪' : '已修改'}
                            </Tag>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="diff-viewer-panel">
                      <div className="diff-review-subhead">
                        <div>
                          <Text strong>{activeDiffFile?.path ?? '选择一个文件查看差异'}</Text>
                          <div className="repo-meta-row">
                            <Tag bordered={false}>{activeArtifact.repository}</Tag>
                            <Tag bordered={false} color="processing">
                              {activeArtifact.branch}
                            </Tag>
                          </div>
                        </div>
                      </div>
                      {activeDiffFile ? (
                        <pre className="diff-code-block">{activeDiffFile.diffText}</pre>
                      ) : (
                        <Empty description="当前仓库没有可查看的差异内容" />
                      )}
                    </div>
                  </div>
                ) : (
                  <Empty description="当前执行结果还没有可审查的 diff" />
                )}
              </Card>
            ) : null}

            {selectedStage === 'AI_REVIEW' ? (
              <Card className="panel finding-panel" bordered={false}>
                <div className="finding-panel-header">
                  <SectionHeader
                    eyebrow="Review Findings"
                    title="审查条目沉淀"
                    description="将 AI 审查结果沉淀为可跟踪的问题项与缺陷，便于后续人工确认和持续处理。"
                  />
                  <div className="finding-panel-actions">
                    <div className="finding-summary-pills">
                      <Tag bordered={false}>{workflowRun.reviewFindings.length} 条条目</Tag>
                      <Tag bordered={false} color="processing">
                        {workflowRun.reviewFindings.filter((item) => item.status === 'OPEN').length} 条待处理
                      </Tag>
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
                          <Text className="finding-card-index">#{finding.id.slice(-6).toUpperCase()}</Text>
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
                              void runFindingAction(finding.id, () => api.convertReviewFindingToIssue(finding.id), '已录入为问题项')
                            }
                            loading={busyFindingId === finding.id}
                            disabled={busyFindingId !== null || !!finding.convertedIssueId || !!finding.convertedBugId}
                          >
                            转问题项
                          </Button>
                          <Button
                            type="primary"
                            className="accent-button"
                            onClick={() =>
                              void runFindingAction(finding.id, () => api.convertReviewFindingToBug(finding.id), '已录入为缺陷')
                            }
                            loading={busyFindingId === finding.id}
                            disabled={busyFindingId !== null || !!finding.convertedIssueId || !!finding.convertedBugId}
                          >
                            转缺陷
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
        </div>
      ) : (
        <Card className="panel empty-panel" bordered={false} loading={loading}>
          <Empty description="未找到工作流" />
        </Card>
      )}
    </AppLayout>
  );
}
