import { Card, Empty, List, Select, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import type { WorkflowRun, Workspace, Requirement } from '../types';
import { formatWorkflowStatus } from '../utils/workflow-ui';

const { Title, Text } = Typography;

export function WorkflowRunsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const workspaceId = searchParams.get('workspaceId') ?? '';
  const requirementId = searchParams.get('requirementId') ?? '';

  const filteredRuns = useMemo(() => {
    return workflowRuns.filter((run) => {
      const matchWorkspace = workspaceId
        ? run.requirement.workspace?.id === workspaceId
        : true;
      const matchRequirement = requirementId ? run.requirement.id === requirementId : true;
      return matchWorkspace && matchRequirement;
    });
  }, [requirementId, workflowRuns, workspaceId]);

  async function refresh() {
    setLoading(true);
    try {
      const [workspaceList, requirementList, runList] = await Promise.all([
        api.getWorkspaces(),
        api.getRequirements(),
        api.getWorkflowRuns(),
      ]);
      setWorkspaces(workspaceList);
      setRequirements(requirementList);
      setWorkflowRuns(runList);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载工作流失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <AppLayout>
      {contextHolder}
      <Card className="panel" bordered={false} loading={loading}>
        <div className="panel-heading panel-heading-inline">
          <div>
            <Text className="eyebrow">Workflow Runs</Text>
            <Title level={4}>工作流列表</Title>
          </div>
          <div className="inline-filter-group">
            <Select
              allowClear
              placeholder="按工作区查看"
              value={workspaceId || undefined}
              style={{ minWidth: 220 }}
              options={workspaces.map((workspace) => ({ label: workspace.name, value: workspace.id }))}
              onChange={(value) => {
                const next = new URLSearchParams(searchParams);
                if (value) {
                  next.set('workspaceId', value);
                } else {
                  next.delete('workspaceId');
                }
                navigate(`/workflow-runs?${next.toString()}`);
              }}
            />
            <Select
              allowClear
              placeholder="按需求查看"
              value={requirementId || undefined}
              style={{ minWidth: 220 }}
              options={requirements.map((requirement) => ({ label: requirement.title, value: requirement.id }))}
              onChange={(value) => {
                const next = new URLSearchParams(searchParams);
                if (value) {
                  next.set('requirementId', value);
                } else {
                  next.delete('requirementId');
                }
                navigate(`/workflow-runs?${next.toString()}`);
              }}
            />
          </div>
        </div>
        <List
          dataSource={filteredRuns}
          locale={{ emptyText: <Empty description="暂无工作流" /> }}
          renderItem={(item) => (
            <List.Item className="run-item">
              <div>
                <Text strong>{item.requirement.title}</Text>
                <div className="run-meta">
                  <Tag bordered={false} color="geekblue">
                    {formatWorkflowStatus(item.status)}
                  </Tag>
                  <Tag bordered={false}>{item.requirement.workspace?.name ?? '未绑定工作区'}</Tag>
                </div>
              </div>
              <Link className="ant-btn ghost-button" to={`/workflow-runs/${item.id}`}>
                查看详情
              </Link>
            </List.Item>
          )}
        />
      </Card>
    </AppLayout>
  );
}
