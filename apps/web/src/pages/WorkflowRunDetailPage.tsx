import { Button, Card, Empty, Form, Input, Modal, Tag, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
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
  const [feedbackModal, setFeedbackModal] = useState<null | {
    stage: 'task-split' | 'plan' | 'execution' | 'review';
    title: string;
  }>(null);
  const [editModal, setEditModal] = useState<null | {
    stage: 'task-split' | 'plan' | 'execution' | 'review';
    title: string;
    initialOutput: unknown;
  }>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [feedbackForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const lastWorkflowSnapshotRef = useRef<string>('');

  function buildWorkflowSnapshot(value: WorkflowRun | null) {
    return JSON.stringify(value);
  }

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
      const stage = feedbackModal.stage;
      if (stage === 'task-split') {
        await api.reviseTaskSplit(workflowRun.id, values.feedback);
      } else if (stage === 'plan') {
        await api.revisePlan(workflowRun.id, values.feedback);
      } else if (stage === 'execution') {
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
      const stage = editModal.stage;
      if (stage === 'task-split') {
        await api.manualEditTaskSplit(workflowRun.id, output);
      } else if (stage === 'plan') {
        await api.manualEditPlan(workflowRun.id, output);
      } else if (stage === 'execution') {
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

  if (!workflowRunId) {
    return <Navigate to="/workflow-runs" replace />;
  }

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

          {workflowRun.workflowRepositories.length > 0 ? (
            <Card className="panel" bordered={false}>
              <div className="panel-heading">
                <div>
                  <Text className="eyebrow">Workflow Branches</Text>
                  <Title level={4}>本次工作流使用的代码分支</Title>
                </div>
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

          <div className="stage-grid">
            <StageCard
              title="阶段 2"
              subtitle="任务拆解"
              status={getStage(workflowRun, 'TASK_SPLIT')?.status}
              statusMessage={getStage(workflowRun, 'TASK_SPLIT')?.statusMessage}
              attempt={getStage(workflowRun, 'TASK_SPLIT')?.attempt}
              output={getStage(workflowRun, 'TASK_SPLIT')?.output ?? { tasks: workflowRun.tasks }}
              actions={[
                {
                  key: 'run',
                  label: '执行任务拆解',
                  onClick: () => void runAction('TASK_SPLIT', () => api.runTaskSplit(workflowRun.id), '任务拆解已启动'),
                  disabled: workflowRun.status !== 'TASK_SPLIT_PENDING' || busyStage !== null,
                  loading: busyStage === 'TASK_SPLIT',
                  variant: 'primary',
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
                  onClick: () => {
                    setFeedbackModal({ stage: 'task-split', title: '任务拆解意见' });
                  },
                  disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION' || busyStage !== null,
                },
                {
                  key: 'edit',
                  label: '人工修改',
                  onClick: () => {
                    const output = getStage(workflowRun, 'TASK_SPLIT')?.output ?? { tasks: workflowRun.tasks };
                    editForm.setFieldsValue({ outputText: JSON.stringify(output, null, 2) });
                    setEditModal({ stage: 'task-split', title: '人工修改任务拆解', initialOutput: output });
                  },
                  disabled: workflowRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION' || busyStage !== null,
                },
              ]}
            />
            <StageCard
              title="阶段 3"
              subtitle="技术方案"
              status={getStage(workflowRun, 'TECHNICAL_PLAN')?.status}
              statusMessage={getStage(workflowRun, 'TECHNICAL_PLAN')?.statusMessage}
              attempt={getStage(workflowRun, 'TECHNICAL_PLAN')?.attempt}
              output={getStage(workflowRun, 'TECHNICAL_PLAN')?.output ?? workflowRun.plan}
              actions={[
                {
                  key: 'run',
                  label: '生成技术方案',
                  onClick: () => void runAction('TECHNICAL_PLAN', () => api.runPlan(workflowRun.id), '技术方案生成已启动'),
                  disabled: workflowRun.status !== 'PLAN_PENDING' || busyStage !== null,
                  loading: busyStage === 'TECHNICAL_PLAN',
                  variant: 'primary',
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
                  onClick: () => {
                    setFeedbackModal({ stage: 'plan', title: '技术方案意见' });
                  },
                  disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION' || busyStage !== null,
                },
                {
                  key: 'edit',
                  label: '人工修改',
                  onClick: () => {
                    const output = getStage(workflowRun, 'TECHNICAL_PLAN')?.output ?? workflowRun.plan;
                    editForm.setFieldsValue({ outputText: JSON.stringify(output, null, 2) });
                    setEditModal({ stage: 'plan', title: '人工修改技术方案', initialOutput: output });
                  },
                  disabled: workflowRun.status !== 'PLAN_WAITING_CONFIRMATION' || busyStage !== null,
                },
              ]}
            />
            <StageCard
              title="阶段 4"
              subtitle="开发执行"
              status={getStage(workflowRun, 'EXECUTION')?.status}
              statusMessage={getStage(workflowRun, 'EXECUTION')?.statusMessage}
              attempt={getStage(workflowRun, 'EXECUTION')?.attempt}
              output={workflowRun.codeExecution}
              actions={[
                {
                  key: 'run',
                  label: '执行开发',
                  onClick: () => void runAction('EXECUTION', () => api.runExecution(workflowRun.id), '开发执行已启动'),
                  disabled: workflowRun.status !== 'EXECUTION_PENDING' || busyStage !== null,
                  loading: busyStage === 'EXECUTION',
                  variant: 'primary',
                },
                {
                  key: 'feedback',
                  label: '提意见给 AI',
                  onClick: () => {
                    setFeedbackModal({ stage: 'execution', title: '开发执行意见' });
                  },
                  disabled: workflowRun.status !== 'REVIEW_PENDING' || busyStage !== null,
                },
                {
                  key: 'edit',
                  label: '人工修改',
                  onClick: () => {
                    const output = workflowRun.codeExecution;
                    editForm.setFieldsValue({ outputText: JSON.stringify(output, null, 2) });
                    setEditModal({ stage: 'execution', title: '人工修改开发执行结果', initialOutput: output });
                  },
                  disabled: !workflowRun.codeExecution || (workflowRun.status !== 'REVIEW_PENDING' && workflowRun.status !== 'HUMAN_REVIEW_PENDING') || busyStage !== null,
                },
              ]}
            />
            <StageCard
              title="阶段 5"
              subtitle="AI 审查"
              status={getStage(workflowRun, 'AI_REVIEW')?.status}
              statusMessage={getStage(workflowRun, 'AI_REVIEW')?.statusMessage}
              attempt={getStage(workflowRun, 'AI_REVIEW')?.attempt}
              output={workflowRun.reviewReport}
              actions={[
                {
                  key: 'run',
                  label: '执行 AI 审查',
                  onClick: () => void runAction('AI_REVIEW', () => api.runReview(workflowRun.id), 'AI 审查已启动'),
                  disabled: workflowRun.status !== 'REVIEW_PENDING' || busyStage !== null,
                  loading: busyStage === 'AI_REVIEW',
                  variant: 'primary',
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
                  onClick: () => {
                    setFeedbackModal({ stage: 'review', title: 'AI 审查意见' });
                  },
                  disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || busyStage !== null,
                },
                {
                  key: 'edit',
                  label: '人工修改',
                  onClick: () => {
                    const output = workflowRun.reviewReport;
                    editForm.setFieldsValue({ outputText: JSON.stringify(output, null, 2) });
                    setEditModal({ stage: 'review', title: '人工修改 AI 审查结果', initialOutput: output });
                  },
                  disabled: workflowRun.status !== 'HUMAN_REVIEW_PENDING' || busyStage !== null,
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
