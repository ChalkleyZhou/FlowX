import { useScopedProjectId } from '../project-scope-context';
import { ProjectLabelSelect } from '../components/ProjectLabelSelect';
import { ProjectLabelBadges } from '../components/ProjectLabelBadges';
import { useProjectLabelFilter } from '../hooks/use-project-label-filter';
import { ListQueryActions } from '../components/ListQueryActions';
import { submitQueryOnEnter, useDraftQuery } from '../hooks/use-draft-query';
import { useListPage } from '../hooks/use-list-page';
import { ListPagination } from '../components/ListPagination';
import { PagedSelect } from '../components/PagedSelect';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const scopedProjectId = useScopedProjectId();
  const labelFilter = useProjectLabelFilter(scopedProjectId);
  const [filters, , replaceFilters] = useStoredListFilters('issues');
  const selectedWorkspaceId = filters.workspaceId;
  const selectedStatus = filters.status;
  const selectedPriority = filters.priority;
  const keyword = filters.keyword ?? '';
  const queryDraft = useDraftQuery({
    keyword,
    workspaceId: selectedWorkspaceId ?? '',
    status: selectedStatus ?? '',
    priority: selectedPriority ?? '',
  });
  const toast = useToast();

  const list = useListPage(api.getIssues, { projectId: scopedProjectId || undefined, workspaceId: selectedWorkspaceId, status: selectedStatus, priority: selectedPriority, labelIds: labelFilter.labelIds.length ? labelFilter.labelIds : undefined, q: keyword || undefined });
  function applyFilters() {
    setSearchParams(current => { const next = new URLSearchParams(current); labelFilter.write(next); return next; });
    replaceFilters({
      keyword: queryDraft.draft.keyword.trim() || undefined,
      workspaceId: queryDraft.draft.workspaceId || undefined,
      status: queryDraft.draft.status || undefined,
      priority: queryDraft.draft.priority || undefined,
    });
  }
  function clearFilters() {
    labelFilter.clear();
    setSearchParams(current => { const next = new URLSearchParams(current); next.delete('labelIds'); next.delete('page'); return next; });
    queryDraft.replace({ keyword: '', workspaceId: '', status: '', priority: '' });
    replaceFilters({ keyword: undefined, workspaceId: undefined, status: undefined, priority: undefined });
  }
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
                    aria-label="搜索问题"
                    placeholder="搜索标题、描述、需求、工作区"
                    value={queryDraft.draft.keyword}
                    onChange={(event) => queryDraft.patch({ keyword: event.target.value })}
                    onKeyDown={(event) => submitQueryOnEnter(event, applyFilters)}
                  />
                )}
                filters={(
                  <>
                    <div className="min-w-48"><ProjectLabelSelect projectId={scopedProjectId} value={labelFilter.draft} onChange={labelFilter.setDraft} label="按标签筛选" /><span className="text-xs text-muted-foreground">匹配任一所选标签</span>{labelFilter.error ? <p role="alert" className="text-xs text-destructive">{labelFilter.error}</p> : null}</div>
                    <PagedSelect value={queryDraft.draft.workspaceId} label="按工作区筛选" placeholder="全部工作区" allowClear emptyLabel="全部工作区" className="w-[180px]" loadPage={api.getWorkspaces}
                      onValueChange={value => queryDraft.patch({ workspaceId: value })} />
                    <Select
                      value={queryDraft.draft.status || '__all__'}
                      onValueChange={(value) => queryDraft.patch({ status: value === '__all__' ? '' : value })}
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
                      value={queryDraft.draft.priority || '__all__'}
                      onValueChange={(value) => queryDraft.patch({ priority: value === '__all__' ? '' : value })}
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
                    <ListQueryActions onQuery={applyFilters} onClear={clearFilters} showClear={Boolean(labelFilter.draft.length || labelFilter.labelIds.length || keyword || selectedWorkspaceId || selectedStatus || selectedPriority || queryDraft.draft.keyword || queryDraft.draft.workspaceId || queryDraft.draft.status || queryDraft.draft.priority)} />
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
                title={<div className="space-y-1"><div className="text-base font-semibold leading-6 text-foreground">{item.title}</div><div className="text-xs font-normal text-muted-foreground">{item.displayCode ?? item.id}</div></div>}
                badges={
                  <>
                    <Badge variant="secondary">{formatIssueStatus(item.status)}</Badge>
                    <Badge variant="outline">{formatPriorityLabel(item.priority)}</Badge>
                    <span className="inline-flex items-center gap-1 text-xs"><span className="text-muted-foreground">标签</span><ProjectLabelBadges labels={item.labels} /></span>
                    {item.workspace?.name ? <Badge variant="default">{item.workspace.name}</Badge> : null}
                  </>
                }
                description={
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span>来源工作流：{item.sourceWorkflowRun?.id ?? '未关联'}</span>
                    {item.sourceWorkflowRun?.id ? (
                      <Link className="text-primary hover:underline" to={`/workflow-runs/${item.sourceWorkflowRun.id}`}>
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
                    <Link to={`/work-items/${item.id}`} state={{ returnTo: `${location.pathname}${location.search}` }}>查看详情</Link>
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
