import {
  Avatar,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Layout,
  List,
  Modal,
  Select,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api';
import { StageCard } from '../components/StageCard';
import type { Requirement, WorkflowRun, Workspace } from '../types';

const { Header, Content } = Layout;
const { Title, Paragraph, Text } = Typography;

function getStage(run: WorkflowRun, stage: string) {
  return run.stageExecutions
    .filter((item) => item.stage === stage)
    .sort((a, b) => b.attempt - a.attempt)[0];
}

function formatWorkflowStatus(status: string) {
  const map: Record<string, string> = {
    CREATED: '已创建',
    TASK_SPLIT_PENDING: '待任务拆解',
    TASK_SPLIT_WAITING_CONFIRMATION: '待确认任务拆解',
    TASK_SPLIT_CONFIRMED: '任务拆解已确认',
    PLAN_PENDING: '待生成方案',
    PLAN_WAITING_CONFIRMATION: '待确认技术方案',
    PLAN_CONFIRMED: '技术方案已确认',
    EXECUTION_PENDING: '待执行开发',
    EXECUTION_RUNNING: '开发执行中',
    REVIEW_PENDING: '待 AI 审查',
    HUMAN_REVIEW_PENDING: '待人工评审',
    DONE: '已完成',
    FAILED: '失败',
  };
  return map[status] ?? status;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { session, logout } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false);
  const [repositoryModalOpen, setRepositoryModalOpen] = useState(false);
  const [repositoryWorkspaceId, setRepositoryWorkspaceId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [workspaceForm] = Form.useForm();
  const [repositoryForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const selectedRun = workflowRuns.find((item) => item.id === selectedRunId) ?? workflowRuns[0];

  const stats = useMemo(
    () => [
      { label: '需求数', value: requirements.length.toString().padStart(2, '0') },
      { label: '工作流', value: workflowRuns.length.toString().padStart(2, '0') },
      {
        label: '待人工处理',
        value: workflowRuns
          .filter((item) =>
            ['TASK_SPLIT_WAITING_CONFIRMATION', 'PLAN_WAITING_CONFIRMATION', 'HUMAN_REVIEW_PENDING'].includes(item.status),
          )
          .length.toString()
          .padStart(2, '0'),
      },
    ],
    [requirements.length, workflowRuns],
  );

  async function refresh() {
    setLoading(true);
    try {
      const [workspacesData, requirementsList, workflowRunsList] = await Promise.all([
        api.getWorkspaces(),
        api.getRequirements(),
        api.getWorkflowRuns(),
      ]);
      setWorkspaces(workspacesData);
      setRequirements(requirementsList);
      setWorkflowRuns(workflowRunsList);
      if (!selectedRunId && workflowRunsList.length > 0) {
        setSelectedRunId(workflowRunsList[0].id);
      }
    } catch (error) {
      const nextError = error instanceof Error ? error.message : '加载失败';
      if (nextError.includes('Session expired') || nextError.includes('Missing bearer token')) {
        logout();
        navigate('/login', { replace: true });
        return;
      }
      messageApi.error(nextError);
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
    workspaceId: string;
  }) {
    try {
      await api.createRequirement(values);
      form.resetFields();
      await refresh();
      messageApi.success('需求创建成功');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '创建失败');
    }
  }

  async function createWorkspace(values: { name: string; description?: string }) {
    try {
      await api.createWorkspace(values);
      workspaceForm.resetFields();
      setWorkspaceModalOpen(false);
      await refresh();
      messageApi.success('工作区创建成功');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '创建工作区失败');
    }
  }

  async function addRepository(values: { name: string; url: string; defaultBranch?: string }) {
    try {
      await api.addRepositoryToWorkspace(repositoryWorkspaceId, values);
      repositoryForm.resetFields();
      setRepositoryModalOpen(false);
      setRepositoryWorkspaceId('');
      await refresh();
      messageApi.success('代码库已加入工作区');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '添加代码库失败');
    }
  }

  async function startWorkflow(requirementId: string) {
    try {
      const run = await api.createWorkflowRun(requirementId);
      await refresh();
      setSelectedRunId(run.id);
      messageApi.success('工作流已启动');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '启动失败');
    }
  }

  async function runAction(action: () => Promise<unknown>, successText: string) {
    try {
      await action();
      await refresh();
      messageApi.success(successText);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '操作失败');
    }
  }

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
    messageApi.success('已退出登录');
  }

  return (
    <Layout className="app-shell">
      {contextHolder}
      <Modal
        title="创建工作区"
        open={workspaceModalOpen}
        footer={null}
        onCancel={() => setWorkspaceModalOpen(false)}
      >
        <Form form={workspaceForm} layout="vertical" onFinish={(values) => void createWorkspace(values)}>
          <Form.Item name="name" label="工作区名称" rules={[{ required: true, message: '请输入工作区名称' }]}>
            <Input placeholder="例如：FlowX 平台" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="说明这个工作区对应的项目或业务边界。" />
          </Form.Item>
          <Button type="primary" htmlType="submit" className="accent-button">
            创建工作区
          </Button>
        </Form>
      </Modal>
      <Modal
        title="收录代码库"
        open={repositoryModalOpen}
        footer={null}
        onCancel={() => setRepositoryModalOpen(false)}
      >
        <Form form={repositoryForm} layout="vertical" onFinish={(values) => void addRepository(values)}>
          <Form.Item name="name" label="代码库名称" rules={[{ required: true, message: '请输入代码库名称' }]}>
            <Input placeholder="例如：flowx-web" />
          </Form.Item>
          <Form.Item name="url" label="仓库地址" rules={[{ required: true, message: '请输入仓库地址' }]}>
            <Input placeholder="https://github.com/org/repo" />
          </Form.Item>
          <Form.Item name="defaultBranch" label="默认分支">
            <Input placeholder="main / master / develop" />
          </Form.Item>
          <Button type="primary" htmlType="submit" className="accent-button">
            添加代码库
          </Button>
        </Form>
      </Modal>
      <Header className="app-header">
        <div className="hero">
          <div className="hero-main">
            <Tag className="hero-tag" bordered={false}>
              FlowX 调度台
            </Tag>
            <Title level={2} className="hero-title">
              AI研发调度系统
            </Title>
            <Paragraph className="hero-copy">
              阶段化、可确认、可回退的研发工作流控制台。AI 负责产出，系统负责编排和状态约束。
            </Paragraph>
          </div>
          <div className="hero-side-panel">
            {session ? (
              <div className="session-panel">
                <Avatar src={session.user.avatarUrl}>
                  {session.user.displayName.slice(0, 1)}
                </Avatar>
                <div>
                  <Text strong>{session.user.displayName}</Text>
                  <div>
                    <Text type="secondary">{session.organization?.name ?? '未绑定组织'}</Text>
                  </div>
                </div>
                <Button className="ghost-button" onClick={handleLogout}>
                  退出
                </Button>
              </div>
            ) : null}
            <div className="hero-focus-card">
              <Text className="hero-focus-label">当前焦点</Text>
              <Title level={4}>{selectedRun?.requirement.title ?? '先创建一个需求'}</Title>
              <Paragraph>
                {selectedRun?.requirement.description ?? '从需求录入开始，逐步推进任务拆解与技术方案确认。'}
              </Paragraph>
            </div>
          </div>
          <div className="hero-stats">
            {stats.map((item) => (
              <Card key={item.label} className="stat-card" bordered={false}>
                <Text className="stat-label">{item.label}</Text>
                <div className="stat-value">{item.value}</div>
              </Card>
            ))}
          </div>
        </div>
      </Header>

      <Content className="app-content">
        <div className="orb orb-left" />
        <div className="orb orb-right" />
        <Spin spinning={loading}>
          <div className="control-grid">
            <div className="left-rail">
              <Card className="panel" bordered={false}>
                <div className="panel-heading">
                  <Text className="eyebrow">项目空间</Text>
                  <Title level={4}>Workspace 与代码库</Title>
                </div>
                <div className="workspace-action-row">
                  <Button className="accent-button" type="primary" onClick={() => setWorkspaceModalOpen(true)}>
                    新建工作区
                  </Button>
                </div>
                <List
                  dataSource={workspaces}
                  locale={{ emptyText: <Empty description="暂无工作区" /> }}
                  renderItem={(workspace) => (
                    <List.Item className="workspace-item">
                      <div className="workspace-copy">
                        <Text strong>{workspace.name}</Text>
                        <Text className="requirement-criteria">
                          {workspace.description || '未填写描述'}
                        </Text>
                        <div className="workspace-meta-row">
                          <Tag bordered={false} color="gold">
                            {workspace.repositories.length} 个代码库
                          </Tag>
                          <Tag bordered={false} color="geekblue">
                            {workspace._count?.requirements ?? 0} 条需求
                          </Tag>
                        </div>
                        {workspace.repositories.length > 0 ? (
                          <div className="repo-chip-row">
                            {workspace.repositories.map((repository) => (
                              <Tag key={repository.id} bordered={false}>
                                {repository.name}
                              </Tag>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <Button
                        className="ghost-button"
                        onClick={() => {
                          setRepositoryWorkspaceId(workspace.id);
                          setRepositoryModalOpen(true);
                        }}
                      >
                        添加代码库
                      </Button>
                    </List.Item>
                  )}
                />
              </Card>

              <Card className="panel panel-form" bordered={false}>
                <div className="panel-heading">
                  <Text className="eyebrow">需求录入</Text>
                  <Title level={4}>新建需求</Title>
                </div>
                <Form form={form} layout="vertical" onFinish={(values) => void createRequirement(values)}>
                  <Form.Item name="workspaceId" label="所属工作区" rules={[{ required: true, message: '请选择工作区' }]}>
                    <Select
                      size="large"
                      placeholder="先选择需求属于哪个项目工作区"
                      options={workspaces.map((workspace) => ({
                        label: workspace.name,
                        value: workspace.id,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="title" label="需求标题" rules={[{ required: true }]}>
                    <Input size="large" placeholder="AI研发调度系统 MVP" />
                  </Form.Item>
                  <Form.Item name="description" label="需求描述" rules={[{ required: true }]}>
                    <Input.TextArea rows={4} placeholder="描述产品目标、范围和约束边界。" />
                  </Form.Item>
                  <Form.Item
                    name="acceptanceCriteria"
                    label="验收标准"
                    rules={[{ required: true }]}
                  >
                    <Input.TextArea rows={4} placeholder="列出本次 MVP 必须满足的验收检查点。" />
                  </Form.Item>
                  <Button type="primary" size="large" htmlType="submit" className="accent-button">
                    创建需求
                  </Button>
                </Form>
              </Card>

              <Card className="panel" bordered={false}>
                <div className="panel-heading">
                  <Text className="eyebrow">需求池</Text>
                  <Title level={4}>需求列表</Title>
                </div>
                <List
                  dataSource={requirements}
                  locale={{ emptyText: <Empty description="暂无需求" /> }}
                  renderItem={(item) => (
                    <List.Item className="requirement-item">
                      <div className="requirement-copy">
                        <Text strong className="requirement-title">
                          {item.title}
                        </Text>
                        <div className="workspace-meta-row">
                          <Tag bordered={false} color="processing">
                            {item.workspace?.name ?? '未绑定工作区'}
                          </Tag>
                        </div>
                        <Text className="requirement-desc">{item.description}</Text>
                        <Text className="requirement-criteria">{item.acceptanceCriteria}</Text>
                      </div>
                      <Button onClick={() => void startWorkflow(item.id)} className="ghost-button">
                        启动工作流
                      </Button>
                    </List.Item>
                  )}
                />
              </Card>
            </div>

            <div className="main-stage">
              <Card className="panel panel-runs" bordered={false}>
                <div className="panel-heading">
                  <Text className="eyebrow">流程总览</Text>
                  <Title level={4}>工作流列表</Title>
                </div>
                <List
                  dataSource={workflowRuns}
                  locale={{ emptyText: <Empty description="暂无工作流" /> }}
                  renderItem={(item) => (
                    <List.Item
                      className={`run-item ${item.id === selectedRun?.id ? 'run-item-active' : ''}`}
                      onClick={() => setSelectedRunId(item.id)}
                    >
                      <div>
                        <Text strong>{item.requirement.title}</Text>
                        <div className="run-meta">
                          <Tag bordered={false} color="geekblue">
                            {formatWorkflowStatus(item.status)}
                          </Tag>
                          <Text type="secondary">{item.id.slice(0, 10)}</Text>
                        </div>
                      </div>
                    </List.Item>
                  )}
                />
              </Card>

              {selectedRun ? (
                <div className="workflow-board">
                  <Card className="panel workflow-banner" bordered={false}>
                    <div className="workflow-banner-copy">
                      <Text className="eyebrow">当前工作流</Text>
                      <Title level={3}>{selectedRun.requirement.title}</Title>
                      <Paragraph>{selectedRun.requirement.description}</Paragraph>
                    </div>
                    <div className="workflow-banner-side">
                      <Tag className="status-pill" bordered={false}>
                        {formatWorkflowStatus(selectedRun.status)}
                      </Tag>
                      <Text className="workflow-criteria">{selectedRun.requirement.acceptanceCriteria}</Text>
                    </div>
                  </Card>

                  <div className="stage-grid">
                    <StageCard
                      title="阶段 2"
                      subtitle="任务拆解"
                      status={getStage(selectedRun, 'TASK_SPLIT')?.status}
                      attempt={getStage(selectedRun, 'TASK_SPLIT')?.attempt}
                      output={getStage(selectedRun, 'TASK_SPLIT')?.output ?? { tasks: selectedRun.tasks }}
                      actions={[
                        {
                          key: 'run',
                          label: '执行任务拆解',
                          onClick: () =>
                            void runAction(() => api.runTaskSplit(selectedRun.id), '任务拆解完成'),
                          disabled: selectedRun.status !== 'TASK_SPLIT_PENDING',
                          variant: 'primary',
                        },
                        {
                          key: 'confirm',
                          label: '确认',
                          onClick: () =>
                            void runAction(() => api.confirmTaskSplit(selectedRun.id), '任务拆解已确认'),
                          disabled: selectedRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION',
                        },
                        {
                          key: 'reject',
                          label: '驳回',
                          onClick: () =>
                            void runAction(() => api.rejectTaskSplit(selectedRun.id), '任务拆解已驳回'),
                          disabled: selectedRun.status !== 'TASK_SPLIT_WAITING_CONFIRMATION',
                          danger: true,
                        },
                      ]}
                    />

                    <StageCard
                      title="阶段 3"
                      subtitle="技术方案"
                      status={getStage(selectedRun, 'TECHNICAL_PLAN')?.status}
                      attempt={getStage(selectedRun, 'TECHNICAL_PLAN')?.attempt}
                      output={getStage(selectedRun, 'TECHNICAL_PLAN')?.output ?? selectedRun.plan}
                      actions={[
                        {
                          key: 'run',
                          label: '生成技术方案',
                          onClick: () =>
                            void runAction(() => api.runPlan(selectedRun.id), '技术方案已生成'),
                          disabled: selectedRun.status !== 'PLAN_PENDING',
                          variant: 'primary',
                        },
                        {
                          key: 'confirm',
                          label: '确认',
                          onClick: () =>
                            void runAction(() => api.confirmPlan(selectedRun.id), '技术方案已确认'),
                          disabled: selectedRun.status !== 'PLAN_WAITING_CONFIRMATION',
                        },
                        {
                          key: 'reject',
                          label: '驳回',
                          onClick: () =>
                            void runAction(() => api.rejectPlan(selectedRun.id), '技术方案已驳回'),
                          disabled: selectedRun.status !== 'PLAN_WAITING_CONFIRMATION',
                          danger: true,
                        },
                      ]}
                    />

                    <StageCard
                      title="阶段 4"
                      subtitle="开发执行"
                      status={getStage(selectedRun, 'EXECUTION')?.status}
                      attempt={getStage(selectedRun, 'EXECUTION')?.attempt}
                      output={selectedRun.codeExecution}
                      actions={[
                        {
                          key: 'run',
                          label: '执行开发',
                          onClick: () =>
                            void runAction(() => api.runExecution(selectedRun.id), '开发执行完成'),
                          disabled: selectedRun.status !== 'EXECUTION_PENDING',
                          variant: 'primary',
                        },
                      ]}
                    />

                    <StageCard
                      title="阶段 5"
                      subtitle="AI 审查"
                      status={getStage(selectedRun, 'AI_REVIEW')?.status}
                      attempt={getStage(selectedRun, 'AI_REVIEW')?.attempt}
                      output={selectedRun.reviewReport}
                      actions={[
                        {
                          key: 'run',
                          label: '执行 AI 审查',
                          onClick: () =>
                            void runAction(() => api.runReview(selectedRun.id), 'AI 审查完成'),
                          disabled: selectedRun.status !== 'REVIEW_PENDING',
                          variant: 'primary',
                        },
                        {
                          key: 'accept',
                          label: '通过',
                          onClick: () =>
                            void runAction(
                              () => api.decideHumanReview(selectedRun.id, 'accept'),
                              '工作流已通过',
                            ),
                          disabled: selectedRun.status !== 'HUMAN_REVIEW_PENDING',
                        },
                        {
                          key: 'rework',
                          label: '返工',
                          onClick: () =>
                            void runAction(
                              () => api.decideHumanReview(selectedRun.id, 'rework'),
                              '工作流已退回开发执行',
                            ),
                          disabled: selectedRun.status !== 'HUMAN_REVIEW_PENDING',
                        },
                        {
                          key: 'rollback',
                          label: '回滚',
                          onClick: () =>
                            void runAction(
                              () => api.decideHumanReview(selectedRun.id, 'rollback'),
                              '工作流已回滚',
                            ),
                          disabled: selectedRun.status !== 'HUMAN_REVIEW_PENDING',
                          danger: true,
                        },
                      ]}
                    />
                  </div>
                </div>
              ) : (
                <Card className="panel empty-panel" bordered={false}>
                  <Empty description="请选择或启动一个工作流来查看阶段详情" />
                </Card>
              )}
            </div>
          </div>
        </Spin>
      </Content>
    </Layout>
  );
}
