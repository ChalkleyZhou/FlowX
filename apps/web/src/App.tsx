import {
  Button,
  Col,
  Form,
  Input,
  Layout,
  List,
  message,
  Row,
  Space,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { api } from './api';
import { StageCard } from './components/StageCard';
import type { Requirement, WorkflowRun } from './types';

const { Header, Content } = Layout;
const { Title, Paragraph, Text } = Typography;

function getStage(run: WorkflowRun, stage: string) {
  return run.stageExecutions
    .filter((item) => item.stage === stage)
    .sort((a, b) => b.attempt - a.attempt)[0];
}

export default function App() {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const selectedRun = workflowRuns.find((item) => item.id === selectedRunId) ?? workflowRuns[0];

  async function refresh() {
    setLoading(true);
    try {
      const [requirementsData, workflowRunsData] = await Promise.all([
        api.getRequirements(),
        api.getWorkflowRuns(),
      ]);
      setRequirements(requirementsData);
      setWorkflowRuns(workflowRunsData);
      if (!selectedRunId && workflowRunsData.length > 0) {
        setSelectedRunId(workflowRunsData[0].id);
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createRequirement(values: {
    title: string;
    description: string;
    acceptanceCriteria: string;
  }) {
    await api.createRequirement(values);
    form.resetFields();
    await refresh();
    messageApi.success('Requirement created');
  }

  async function startWorkflow(requirementId: string) {
    const run = await api.createWorkflowRun(requirementId);
    await refresh();
    setSelectedRunId(run.id);
    messageApi.success('Workflow started');
  }

  async function runAction(action: () => Promise<unknown>, successText: string) {
    try {
      await action();
      await refresh();
      messageApi.success(successText);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Operation failed');
    }
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {contextHolder}
      <Header style={{ background: '#0f172a' }}>
        <Title level={3} style={{ color: '#fff', margin: 0, lineHeight: '64px' }}>
          AI研发调度系统 MVP
        </Title>
      </Header>
      <Content style={{ padding: 24 }}>
        <Row gutter={24} align="top">
          <Col span={8}>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <Form form={form} layout="vertical" onFinish={(values) => void createRequirement(values)}>
                <Title level={4}>Create Requirement</Title>
                <Form.Item name="title" label="Title" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
                <Form.Item name="description" label="Description" rules={[{ required: true }]}>
                  <Input.TextArea rows={4} />
                </Form.Item>
                <Form.Item
                  name="acceptanceCriteria"
                  label="Acceptance Criteria"
                  rules={[{ required: true }]}
                >
                  <Input.TextArea rows={4} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={loading}>
                  Create
                </Button>
              </Form>

              <div>
                <Title level={4}>Requirements</Title>
                <List
                  bordered
                  dataSource={requirements}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="start" onClick={() => void startWorkflow(item.id)}>
                          Start Workflow
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        title={item.title}
                        description={
                          <Space direction="vertical" size={0}>
                            <Text>{item.description}</Text>
                            <Text type="secondary">{item.acceptanceCriteria}</Text>
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              </div>
            </Space>
          </Col>

          <Col span={16}>
            <Title level={4}>Workflow Runs</Title>
            <List
              bordered
              dataSource={workflowRuns}
              style={{ marginBottom: 16 }}
              renderItem={(item) => (
                <List.Item
                  onClick={() => setSelectedRunId(item.id)}
                  style={{
                    cursor: 'pointer',
                    background: item.id === selectedRun?.id ? '#e6f4ff' : '#fff',
                  }}
                >
                  <List.Item.Meta
                    title={`${item.requirement.title} · ${item.status}`}
                    description={`Workflow ID: ${item.id}`}
                  />
                </List.Item>
              )}
            />

            {selectedRun ? (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Paragraph>
                  <Text strong>Current workflow:</Text> {selectedRun.requirement.title}
                </Paragraph>
                <StageCard
                  title="Stage 2: Task Split"
                  status={getStage(selectedRun, 'TASK_SPLIT')?.status}
                  output={getStage(selectedRun, 'TASK_SPLIT')?.output ?? { tasks: selectedRun.tasks }}
                  actions={[
                    {
                      key: 'run',
                      label: 'Run Task Split',
                      onClick: () =>
                        void runAction(() => api.runTaskSplit(selectedRun.id), 'Task split completed'),
                      disabled: selectedRun.status !== 'TASK_SPLIT_PENDING',
                    },
                    {
                      key: 'confirm',
                      label: 'Confirm',
                      onClick: () =>
                        void runAction(
                          () => api.confirmTaskSplit(selectedRun.id),
                          'Task split confirmed',
                        ),
                      disabled: selectedRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION',
                    },
                    {
                      key: 'reject',
                      label: 'Reject',
                      onClick: () =>
                        void runAction(
                          () => api.rejectTaskSplit(selectedRun.id),
                          'Task split rejected',
                        ),
                      disabled: selectedRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION',
                    },
                  ]}
                />

                <StageCard
                  title="Stage 3: Technical Plan"
                  status={getStage(selectedRun, 'TECHNICAL_PLAN')?.status}
                  output={getStage(selectedRun, 'TECHNICAL_PLAN')?.output ?? selectedRun.plan}
                  actions={[
                    {
                      key: 'run',
                      label: 'Run Plan',
                      onClick: () =>
                        void runAction(() => api.runPlan(selectedRun.id), 'Plan generated'),
                      disabled: selectedRun.status !== 'PLAN_PENDING',
                    },
                    {
                      key: 'confirm',
                      label: 'Confirm',
                      onClick: () =>
                        void runAction(() => api.confirmPlan(selectedRun.id), 'Plan confirmed'),
                      disabled: selectedRun.status !== 'PLAN_WAITING_CONFIRMATION',
                    },
                    {
                      key: 'reject',
                      label: 'Reject',
                      onClick: () =>
                        void runAction(() => api.rejectPlan(selectedRun.id), 'Plan rejected'),
                      disabled: selectedRun.status !== 'PLAN_WAITING_CONFIRMATION',
                    },
                  ]}
                />

                <StageCard
                  title="Stage 4: Execution"
                  status={getStage(selectedRun, 'EXECUTION')?.status}
                  output={selectedRun.codeExecution}
                  actions={[
                    {
                      key: 'run',
                      label: 'Run Execution',
                      onClick: () =>
                        void runAction(
                          () => api.runExecution(selectedRun.id),
                          'Execution finished',
                        ),
                      disabled: selectedRun.status !== 'EXECUTION_PENDING',
                    },
                  ]}
                />

                <StageCard
                  title="Stage 5: AI Review"
                  status={getStage(selectedRun, 'AI_REVIEW')?.status}
                  output={selectedRun.reviewReport}
                  actions={[
                    {
                      key: 'run',
                      label: 'Run Review',
                      onClick: () =>
                        void runAction(() => api.runReview(selectedRun.id), 'AI review finished'),
                      disabled: selectedRun.status !== 'REVIEW_PENDING',
                    },
                    {
                      key: 'accept',
                      label: 'Accept',
                      onClick: () =>
                        void runAction(
                          () => api.decideHumanReview(selectedRun.id, 'accept'),
                          'Workflow accepted',
                        ),
                      disabled: selectedRun.status !== 'HUMAN_REVIEW_PENDING',
                    },
                    {
                      key: 'rework',
                      label: 'Rework',
                      onClick: () =>
                        void runAction(
                          () => api.decideHumanReview(selectedRun.id, 'rework'),
                          'Workflow sent back to execution',
                        ),
                      disabled: selectedRun.status !== 'HUMAN_REVIEW_PENDING',
                    },
                    {
                      key: 'rollback',
                      label: 'Rollback',
                      onClick: () =>
                        void runAction(
                          () => api.decideHumanReview(selectedRun.id, 'rollback'),
                          'Workflow rolled back',
                        ),
                      disabled: selectedRun.status !== 'HUMAN_REVIEW_PENDING',
                    },
                  ]}
                />
              </Space>
            ) : (
              <Paragraph type="secondary">No workflow selected.</Paragraph>
            )}
          </Col>
        </Row>
      </Content>
    </Layout>
  );
}
