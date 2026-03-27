import { Card, Empty, Input, List, Select, Tag, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { AppLayout } from '../components/AppLayout';
import { ListToolbar } from '../components/ListToolbar';
import { PageHero } from '../components/PageHero';
import { RecordListItem } from '../components/RecordListItem';
import { SectionHeader } from '../components/SectionHeader';
import { SummaryMetrics } from '../components/SummaryMetrics';
import type { Issue, Workspace } from '../types';

const { Text, Paragraph } = Typography;

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

  const issueSummary = useMemo(() => {
    const openCount = issues.filter((item) => item.status === 'OPEN').length;
    const inProgressCount = issues.filter((item) => item.status === 'IN_PROGRESS').length;
    return {
      total: issues.length,
      visible: filteredIssues.length,
      openCount,
      inProgressCount,
    };
  }, [filteredIssues.length, issues]);

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
      <PageHero
        eyebrow="Issue Registry"
        title="问题项中心"
        description="汇总 AI 审查沉淀的问题项，按工作区、状态和优先级持续跟踪，确保风险和改进建议都有归属。"
      />
      <SummaryMetrics
        items={[
          { key: 'total', label: '问题项总数', value: issueSummary.total },
          { key: 'visible', label: '当前筛选结果', value: issueSummary.visible },
          { key: 'openCount', label: '开放中', value: issueSummary.openCount },
          { key: 'inProgressCount', label: '处理中', value: issueSummary.inProgressCount },
        ]}
      />
      <Card className="panel" bordered={false} loading={loading}>
        <SectionHeader eyebrow="Issue Registry" title="问题项列表" />
        <div className="filter-toolbar-panel filter-toolbar-grid">
          <div className="filter-toolbar-search filter-toolbar-span-full">
            <Input.Search
              allowClear
              placeholder="搜索标题、描述、需求、工作区"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
          <ListToolbar className="filter-toolbar-selects filter-toolbar-span-full">
            <Select
              allowClear
              placeholder="按工作区筛选"
              value={selectedWorkspaceId}
              onChange={(value) => setSelectedWorkspaceId(value)}
              options={workspaces.map((workspace) => ({ label: workspace.name, value: workspace.id }))}
            />
            <Select
              allowClear
              placeholder="按状态筛选"
              value={selectedStatus}
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
              onChange={(value) => setSelectedPriority(value)}
              options={[
                { label: 'LOW', value: 'LOW' },
                { label: 'MEDIUM', value: 'MEDIUM' },
                { label: 'HIGH', value: 'HIGH' },
                { label: 'URGENT', value: 'URGENT' },
              ]}
            />
          </ListToolbar>
        </div>
        <List
          dataSource={filteredIssues}
          locale={{ emptyText: <Empty description="暂无问题项" /> }}
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
              <RecordListItem
                title={<Text strong className="requirement-title">{item.title}</Text>}
                badges={
                  <>
                    <Tag bordered={false} color="processing">
                      {item.workspace?.name ?? '未绑定工作区'}
                    </Tag>
                    <Tag bordered={false}>{item.priority}</Tag>
                    <Tag bordered={false}>{item.status}</Tag>
                  </>
                }
                description={<Paragraph className="requirement-desc">{item.description}</Paragraph>}
                details={
                  <>
                    <Text className="requirement-criteria">来源需求：{item.requirement?.title ?? '未关联需求'}</Text>
                    <Text className="requirement-criteria">分支：{item.branchName ?? '未记录分支'}</Text>
                  </>
                }
                actions={
                  <>
                    <Link className="ant-btn ghost-button" to={`/issues/${item.id}`}>
                      查看详情
                    </Link>
                    {item.workflowRun?.id ? (
                      <Link className="ant-btn ghost-button" to={`/workflow-runs/${item.workflowRun.id}`}>
                        查看来源流程
                      </Link>
                    ) : null}
                  </>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </AppLayout>
  );
}
