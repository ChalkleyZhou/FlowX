import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { ListToolbar } from '../components/ListToolbar';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { RecordListItem } from '../components/RecordListItem';
import { SectionHeader } from '../components/SectionHeader';
import { Badge } from '../components/ui/badge';
import { Button as UiButton } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Input as UiInput } from '../components/ui/input';
import { Spinner } from '../components/ui/spinner';
import { useToast } from '../components/ui/toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import type { Issue, Workspace } from '../types';
import { formatIssueStatus, formatPriority, formatPriorityLabel } from '../utils/label-utils';

export function IssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [selectedStatus, setSelectedStatus] = useState<string>();
  const [selectedPriority, setSelectedPriority] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

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

  const pagedIssues = useMemo(() => {
    const start = (page - 1) * 8;
    return filteredIssues.slice(start, start + 8);
  }, [filteredIssues, page]);

  const totalPages = Math.max(1, Math.ceil(filteredIssues.length / 8));

  async function refresh() {
    setLoading(true);
    try {
      const [issueList, workspaceList] = await Promise.all([api.getIssues(), api.getWorkspaces()]);
      setIssues(issueList);
      setWorkspaces(workspaceList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载问题项失败');
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
    <>
      <PageHeader
        eyebrow="Issue Registry"
        title="问题项中心"
        description="汇总 AI 审查沉淀的问题项，按工作区、状态和优先级持续跟踪，确保风险和改进建议都有归属。"
      />
      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard label="问题项总数" value={issueSummary.total} />
        <MetricCard label="当前筛选结果" value={issueSummary.visible} />
        <MetricCard label="开放中" value={issueSummary.openCount} />
        <MetricCard label="处理中" value={issueSummary.inProgressCount} />
      </div>
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Issue Registry" title="问题项列表" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="h-7 w-7" />
            </div>
          ) : (
            <>
              <ListToolbar
                search={(
                  <UiInput
                    placeholder="搜索标题、描述、需求、工作区"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                  />
                )}
                filters={(
                  <>
                    <Select
                      value={selectedWorkspaceId ?? '__all__'}
                      onValueChange={(value) => setSelectedWorkspaceId(value === '__all__' ? undefined : value)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="按工作区筛选" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">全部工作区</SelectItem>
                        {workspaces.map((workspace) => (
                          <SelectItem key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedStatus ?? '__all__'}
                      onValueChange={(value) => setSelectedStatus(value === '__all__' ? undefined : value)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="按状态筛选" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">全部状态</SelectItem>
                        <SelectItem value="OPEN">{formatIssueStatus('OPEN')}</SelectItem>
                        <SelectItem value="IN_PROGRESS">{formatIssueStatus('IN_PROGRESS')}</SelectItem>
                        <SelectItem value="RESOLVED">{formatIssueStatus('RESOLVED')}</SelectItem>
                        <SelectItem value="CLOSED">{formatIssueStatus('CLOSED')}</SelectItem>
                        <SelectItem value="WONT_FIX">{formatIssueStatus('WONT_FIX')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedPriority ?? '__all__'}
                      onValueChange={(value) => setSelectedPriority(value === '__all__' ? undefined : value)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="按优先级筛选" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">全部优先级</SelectItem>
                        <SelectItem value="LOW">{formatPriority('LOW')}</SelectItem>
                        <SelectItem value="MEDIUM">{formatPriority('MEDIUM')}</SelectItem>
                        <SelectItem value="HIGH">{formatPriority('HIGH')}</SelectItem>
                        <SelectItem value="URGENT">{formatPriority('URGENT')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                )}
              />
        {pagedIssues.length > 0 ? (
          <>
            <div className="flex flex-col gap-3.5">
              {pagedIssues.map((item) => (
              <RecordListItem
                key={item.id}
                className="shadow-none"
                title={<div className="text-base font-semibold leading-6 text-foreground">{item.title}</div>}
                badges={
                  <>
                    <Badge variant="secondary">{formatIssueStatus(item.status)}</Badge>
                    <Badge variant="outline">{formatPriorityLabel(item.priority)}</Badge>
                    {item.workspace?.name ? <Badge variant="default">{item.workspace.name}</Badge> : null}
                  </>
                }
                description={
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span>来源需求：{item.requirement?.title ?? '未关联需求'}</span>
                    {item.workflowRun?.id ? (
                      <Link className="text-primary hover:underline" to={`/workflow-runs/${item.workflowRun.id}`}>
                        查看来源流程
                      </Link>
                    ) : null}
                  </div>
                }
                details={
                  item.branchName ? <span className="text-xs text-muted-foreground">分支：{item.branchName}</span> : null
                }
                actions={
                  <UiButton variant="outline" asChild>
                    <Link to={`/issues/${item.id}`}>查看详情</Link>
                  </UiButton>
                }
              />
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 mt-4 border-t border-border pt-4">
              <span className="text-sm text-muted-foreground">共 {filteredIssues.length} 条</span>
              <div className="flex items-center gap-2.5">
                <UiButton variant="outline" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
                  上一页
                </UiButton>
                <span className="text-sm text-muted-foreground">第 {page} / {totalPages} 页</span>
                <UiButton variant="outline" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>
                  下一页
                </UiButton>
              </div>
            </div>
          </>
        ) : (
          <EmptyState description="当前还没有沉淀的问题项，先在工作流审查里同步 findings。" />
        )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
