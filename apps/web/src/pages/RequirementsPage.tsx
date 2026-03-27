import { Button, Card, Empty, Form, Input, List, Select, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import type { Requirement, Workspace } from '../types';

const { Title, Text } = Typography;

export function RequirementsPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const filteredRequirements = useMemo(() => {
    if (!selectedWorkspaceId) {
      return requirements;
    }
    return requirements.filter((item) => item.workspace?.id === selectedWorkspaceId);
  }, [requirements, selectedWorkspaceId]);

  async function refresh() {
    setLoading(true);
    try {
      const [workspaceList, requirementList] = await Promise.all([
        api.getWorkspaces(),
        api.getRequirements(),
      ]);
      setWorkspaces(workspaceList);
      setRequirements(requirementList);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载需求失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createRequirement(values: {
    workspaceId: string;
    title: string;
    description: string;
    acceptanceCriteria: string;
  }) {
    try {
      await api.createRequirement(values);
      form.resetFields();
      setSelectedWorkspaceId(values.workspaceId);
      await refresh();
      messageApi.success('需求创建成功');
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '创建需求失败');
    }
  }

  async function startWorkflow(requirementId: string) {
    try {
      const run = await api.createWorkflowRun(requirementId);
      messageApi.success('工作流已启动');
      navigate(`/workflow-runs/${run.id}`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '启动工作流失败');
    }
  }

  return (
    <AppLayout>
      {contextHolder}
      <div className="page-grid">
        <Card className="panel panel-form" bordered={false}>
          <div className="panel-heading">
            <Text className="eyebrow">Requirement Intake</Text>
            <Title level={4}>创建需求</Title>
          </div>
          <Form form={form} layout="vertical" onFinish={(values) => void createRequirement(values)}>
            <Form.Item name="workspaceId" label="所属工作区" rules={[{ required: true, message: '请选择工作区' }]}>
              <Select
                size="large"
                placeholder="选择需求属于哪个项目"
                options={workspaces.map((workspace) => ({ label: workspace.name, value: workspace.id }))}
              />
            </Form.Item>
            <Form.Item name="title" label="需求标题" rules={[{ required: true }]}>
              <Input size="large" placeholder="AI研发调度系统 MVP" />
            </Form.Item>
            <Form.Item name="description" label="需求描述" rules={[{ required: true }]}>
              <Input.TextArea rows={4} placeholder="描述产品目标、范围和约束边界。" />
            </Form.Item>
            <Form.Item name="acceptanceCriteria" label="验收标准" rules={[{ required: true }]}>
              <Input.TextArea rows={4} placeholder="列出本次迭代必须满足的验收检查点。" />
            </Form.Item>
            <Button type="primary" size="large" htmlType="submit" className="accent-button">
              创建需求
            </Button>
          </Form>
        </Card>

        <Card className="panel" bordered={false} loading={loading}>
          <div className="panel-heading panel-heading-inline">
            <div>
              <Text className="eyebrow">Requirement Pool</Text>
              <Title level={4}>需求列表</Title>
            </div>
            <Select
              allowClear
              placeholder="按工作区筛选"
              style={{ minWidth: 220 }}
              value={selectedWorkspaceId}
              onChange={(value) => setSelectedWorkspaceId(value)}
              options={workspaces.map((workspace) => ({ label: workspace.name, value: workspace.id }))}
            />
          </div>
          <List
            dataSource={filteredRequirements}
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
                <div className="inline-action-group">
                  <Button className="ghost-button" onClick={() => void startWorkflow(item.id)}>
                    启动工作流
                  </Button>
                  <Button className="ghost-button" onClick={() => navigate(`/workflow-runs?requirementId=${item.id}`)}>
                    查看流程
                  </Button>
                </div>
              </List.Item>
            )}
          />
        </Card>
      </div>
    </AppLayout>
  );
}
