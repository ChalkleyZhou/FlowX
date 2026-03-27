import { Card, Empty, List, Select, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import { ListToolbar } from '../components/ListToolbar';
import { PageHero } from '../components/PageHero';
import { RecordListItem } from '../components/RecordListItem';
import { SectionHeader } from '../components/SectionHeader';
import { SummaryMetrics } from '../components/SummaryMetrics';
import type { WorkflowRun, Workspace, Requirement } from '../types';
import { formatWorkflowStatus } from '../utils/workflow-ui';

const { Text } = Typography;

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

  const workflowSummary = useMemo(() => {
    const runningCount = workflowRuns.filter((run) => run.status === 'EXECUTION_RUNNING').length;
    const pendingCount = workflowRuns.filter((run) => run.status.includes('PENDING') || run.status.includes('WAITING')).length;
    return {
      total: workflowRuns.length,
      visible: filteredRuns.length,
      running: runningCount,
      pending: pendingCount,
    };
  }, [filteredRuns.length, workflowRuns]);

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
      <PageHero
        eyebrow="Workflow Runs"
        title="工作流列表"
        description="从工作区和需求维度查看流程推进情况，快速定位待确认、执行中和需要人工评审的工作流。"
      />
      <SummaryMetrics
        items={[
          { key: 'total', label: '工作流总数', value: workflowSummary.total },
          { key: 'visible', label: '当前筛选结果', value: workflowSummary.visible },
          { key: 'running', label: '执行中', value: workflowSummary.running },
          { key: 'pending', label: '待处理', value: workflowSummary.pending },
        ]}
      />
      <Card className="panel" bordered={false} loading={loading}>
        <SectionHeader
          eyebrow="Workflow Runs"
          title="工作流列表"
          extra={
            <ListToolbar>
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
            </ListToolbar>
          }
        />
        <List
          dataSource={filteredRuns}
          locale={{ emptyText: <Empty description="暂无工作流" /> }}
          renderItem={(item) => (
            <List.Item className="run-item">
              <RecordListItem
                title={<Text strong className="requirement-title">{item.requirement.title}</Text>}
                badges={
                  <>
                    <Tag bordered={false} color="geekblue">
                      {formatWorkflowStatus(item.status)}
                    </Tag>
                    <Tag bordered={false}>{item.requirement.workspace?.name ?? '未绑定工作区'}</Tag>
                  </>
                }
                details={<Text className="requirement-criteria">{item.requirement.description}</Text>}
                actions={
                  <Link className="ant-btn ghost-button" to={`/workflow-runs/${item.id}`}>
                    查看详情
                  </Link>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </AppLayout>
  );
}
