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
import type { Bug, Workspace } from '../types';

const { Text, Paragraph } = Typography;

export function BugsPage() {
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [selectedStatus, setSelectedStatus] = useState<string>();
  const [selectedSeverity, setSelectedSeverity] = useState<string>();
  const [selectedPriority, setSelectedPriority] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const filteredBugs = useMemo(() => {
    return bugs.filter((bug) => {
      const matchesWorkspace = selectedWorkspaceId ? bug.workspace?.id === selectedWorkspaceId : true;
      const matchesStatus = selectedStatus ? bug.status === selectedStatus : true;
      const matchesSeverity = selectedSeverity ? bug.severity === selectedSeverity : true;
      const matchesPriority = selectedPriority ? bug.priority === selectedPriority : true;
      const normalizedKeyword = keyword.trim().toLowerCase();
      const matchesKeyword = normalizedKeyword
        ? [bug.title, bug.description, bug.requirement?.title ?? '', bug.workspace?.name ?? '']
            .join(' ')
            .toLowerCase()
            .includes(normalizedKeyword)
        : true;
      return matchesWorkspace && matchesStatus && matchesSeverity && matchesPriority && matchesKeyword;
    });
  }, [bugs, keyword, selectedPriority, selectedSeverity, selectedStatus, selectedWorkspaceId]);

  const bugSummary = useMemo(() => {
    const openCount = bugs.filter((item) => item.status === 'OPEN').length;
    const criticalCount = bugs.filter((item) => item.severity === 'CRITICAL').length;
    return {
      total: bugs.length,
      visible: filteredBugs.length,
      openCount,
      criticalCount,
    };
  }, [bugs, filteredBugs.length]);

  async function refresh() {
    setLoading(true);
    try {
      const [bugList, workspaceList] = await Promise.all([api.getBugs(), api.getWorkspaces()]);
      setBugs(bugList);
      setWorkspaces(workspaceList);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '加载 Bug 失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [keyword, selectedPriority, selectedSeverity, selectedStatus, selectedWorkspaceId]);

  return (
    <AppLayout>
      {contextHolder}
      <PageHero
        eyebrow="Bug Registry"
        title="缺陷中心"
        description="集中管理 AI 审查和人工确认后的缺陷，统一查看严重级别、优先级、来源流程和修复上下文。"
      />
      <SummaryMetrics
        items={[
          { key: 'total', label: '缺陷总数', value: bugSummary.total },
          { key: 'visible', label: '当前筛选结果', value: bugSummary.visible },
          { key: 'openCount', label: '开放中', value: bugSummary.openCount },
          { key: 'criticalCount', label: '严重缺陷', value: bugSummary.criticalCount },
        ]}
      />
      <Card className="panel" bordered={false} loading={loading}>
        <SectionHeader eyebrow="Bug Registry" title="缺陷列表" />
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
                { label: 'CONFIRMED', value: 'CONFIRMED' },
                { label: 'FIXING', value: 'FIXING' },
                { label: 'FIXED', value: 'FIXED' },
                { label: 'VERIFIED', value: 'VERIFIED' },
                { label: 'CLOSED', value: 'CLOSED' },
                { label: 'WONT_FIX', value: 'WONT_FIX' },
              ]}
            />
            <Select
              allowClear
              placeholder="按严重级别筛选"
              value={selectedSeverity}
              onChange={(value) => setSelectedSeverity(value)}
              options={[
                { label: 'LOW', value: 'LOW' },
                { label: 'MEDIUM', value: 'MEDIUM' },
                { label: 'HIGH', value: 'HIGH' },
                { label: 'CRITICAL', value: 'CRITICAL' },
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
          dataSource={filteredBugs}
          locale={{ emptyText: <Empty description="暂无缺陷" /> }}
          pagination={{
            current: page,
            pageSize: 8,
            total: filteredBugs.length,
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
                    <Tag bordered={false} color="error">
                      {item.severity}
                    </Tag>
                    <Tag bordered={false}>{item.priority}</Tag>
                    <Tag bordered={false}>{item.status}</Tag>
                    <Tag bordered={false} color="processing">
                      {item.workspace?.name ?? '未绑定工作区'}
                    </Tag>
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
                    <Link className="ant-btn ghost-button" to={`/bugs/${item.id}`}>
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
