import { Card, Empty, Input, List, Select, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import type { Issue, Workspace } from '../types';

const { Title, Text, Paragraph } = Typography;

export function IssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [selectedStatus, setSelectedStatus] = useState<string>();
  const [selectedPriority, setSelectedPriority] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      const matchesWorkspace = selectedWorkspaceId ? issue.workspace?.id === selectedWorkspaceId : true;
      const matchesStatus = selectedStatus ? issue.status === selectedStatus : true;
      const matchesPriority = selectedPriority ? issue.priority === selectedPriority : true;
      const normalizedKeyword = keyword.trim().toLowerCase();
      const matchesKeyword = normalizedKeyword
        ? [issue.title, issue.description, issue.requirement?.title ?? '', issue.workspace?.name ?? '']
            .join(' ')
            .toLowerCase()
            .includes(normalizedKeyword)
        : true;
      return matchesWorkspace && matchesStatus && matchesPriority && matchesKeyword;
    });
  }, [issues, keyword, selectedPriority, selectedStatus, selectedWorkspaceId]);

  async function refresh() {
    setLoading(true);
    try {
      const [issueList, workspaceList] = await Promise.all([api.getIssues(), api.getWorkspaces()]);
      setIssues(issueList);
      setWorkspaces(workspaceList);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载 Issue 失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [keyword, selectedPriority, selectedStatus, selectedWorkspaceId]);

  return (
    <AppLayout>
      {contextHolder}
      <Card className="panel" bordered={false} loading={loading}>
        <div className="panel-heading panel-heading-inline">
          <div>
            <Text className="eyebrow">Issue Registry</Text>
            <Title level={4}>Issue 列表</Title>
          </div>
          <div className="inline-filter-group">
            <Input.Search
              allowClear
              placeholder="搜索标题、描述、需求、工作区"
              value={keyword}
              style={{ minWidth: 260 }}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              allowClear
              placeholder="按工作区筛选"
              value={selectedWorkspaceId}
              style={{ minWidth: 220 }}
              onChange={(value) => setSelectedWorkspaceId(value)}
              options={workspaces.map((workspace) => ({ label: workspace.name, value: workspace.id }))}
            />
            <Select
              allowClear
              placeholder="按状态筛选"
              value={selectedStatus}
              style={{ minWidth: 180 }}
              onChange={(value) => setSelectedStatus(value)}
              options={[
                { label: 'OPEN', value: 'OPEN' },
                { label: 'IN_PROGRESS', value: 'IN_PROGRESS' },
                { label: 'RESOLVED', value: 'RESOLVED' },
                { label: 'CLOSED', value: 'CLOSED' },
                { label: 'WONT_FIX', value: 'WONT_FIX' },
              ]}
            />
            <Select
              allowClear
              placeholder="按优先级筛选"
              value={selectedPriority}
              style={{ minWidth: 180 }}
              onChange={(value) => setSelectedPriority(value)}
              options={[
                { label: 'LOW', value: 'LOW' },
                { label: 'MEDIUM', value: 'MEDIUM' },
                { label: 'HIGH', value: 'HIGH' },
                { label: 'URGENT', value: 'URGENT' },
              ]}
            />
          </div>
        </div>
        <List
          dataSource={filteredIssues}
          locale={{ emptyText: <Empty description="暂无 Issue" /> }}
          pagination={{
            current: page,
            pageSize: 8,
            total: filteredIssues.length,
            showSizeChanger: false,
            onChange: (nextPage) => setPage(nextPage),
            showTotal: (total) => `共 ${total} 条`,
          }}
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
                  <Tag bordered={false}>{item.priority}</Tag>
                  <Tag bordered={false}>{item.status}</Tag>
                </div>
                <Paragraph className="requirement-desc">{item.description}</Paragraph>
                <Text className="requirement-criteria">
                  来源需求：{item.requirement?.title ?? '未关联需求'}
                </Text>
                <Text className="requirement-criteria">
                  分支：{item.branchName ?? '未记录分支'}
                </Text>
              </div>
              <div className="inline-action-group">
                <Link className="ant-btn ghost-button" to={`/issues/${item.id}`}>
                  查看详情
                </Link>
                {item.workflowRun?.id ? (
                  <Link className="ant-btn ghost-button" to={`/workflow-runs/${item.workflowRun.id}`}>
                    查看来源流程
                  </Link>
                ) : null}
              </div>
            </List.Item>
          )}
        />
      </Card>
    </AppLayout>
  );
}
