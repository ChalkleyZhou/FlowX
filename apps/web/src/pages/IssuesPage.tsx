import { useListPage } from '../hooks/use-list-page';
import { ListPagination } from '../components/ListPagination';
import { PagedSelect } from '../components/PagedSelect';
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
import { useStoredListFilters } from '../utils/list-filter-storage';

export function IssuesPage() {
  const [filters, setFilter] = useStoredListFilters('issues');
  const selectedWorkspaceId = filters.workspaceId;
  const selectedStatus = filters.status;
  const selectedPriority = filters.priority;
  const keyword = filters.keyword ?? '';
  const toast = useToast();

  const list = useListPage(api.getIssues, { workspaceId: selectedWorkspaceId, status: selectedStatus, priority: selectedPriority, q: keyword || undefined });
  const { items: pagedIssues, loading, refresh } = list;
  const issueSummary = { ...{total: 0, visible: 0, openCount: 0, inProgressCount: 0}, ...list.summary };

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
      <Card className="rounded-md border border-border bg-card">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Issue Registry" title="问题项列表" />
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {list.error ? <p role="alert" className="mb-3 text-sm text-destructive">{list.error}<UiButton variant="ghost" onClick={refresh}>重试</UiButton></p> : null}
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
                    onChange={(event) => setFilter('keyword', event.target.value || undefined)}
                  />
                )}
                filters={(
                  <>
                    <PagedSelect value={selectedWorkspaceId ?? ''} label="按工作区筛选" placeholder="全部工作区" allowClear emptyLabel="全部工作区" className="w-[180px]" loadPage={api.getWorkspaces}
                      onValueChange={value => setFilter('workspaceId', value || undefined)} />
                    <Select
                      value={selectedStatus ?? '__all__'}
                      onValueChange={(value) => setFilter('status', value === '__all__' ? undefined : value)}
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
                      onValueChange={(value) => setFilter('priority', value === '__all__' ? undefined : value)}
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
            <ListPagination page={list.page} total={list.total} loading={loading} onPageChange={list.onPageChange} label="Issue列表分页" />
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
