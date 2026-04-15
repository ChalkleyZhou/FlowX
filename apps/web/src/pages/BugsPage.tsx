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
import type { Bug, Workspace } from '../types';
import {
  formatBugStatus,
  formatPriority,
  formatPriorityLabel,
  formatSeverity,
  formatSeverityLabel,
} from '../utils/label-utils';

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
  const toast = useToast();

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

  const pagedBugs = useMemo(() => {
    const start = (page - 1) * 8;
    return filteredBugs.slice(start, start + 8);
  }, [filteredBugs, page]);

  const totalPages = Math.max(1, Math.ceil(filteredBugs.length / 8));

  async function refresh() {
    setLoading(true);
    try {
      const [bugList, workspaceList] = await Promise.all([api.getBugs(), api.getWorkspaces()]);
      setBugs(bugList);
      setWorkspaces(workspaceList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载缺陷失败');
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
    <>
      <PageHeader
        eyebrow="Bug Registry"
        title="缺陷中心"
        description="集中管理 AI 审查和人工确认后的缺陷，统一查看严重级别、优先级、来源流程和修复上下文。"
      />
      <div className="grid gap-5 md:grid-cols-4">
        <MetricCard label="缺陷总数" value={bugSummary.total} />
        <MetricCard label="当前筛选结果" value={bugSummary.visible} />
        <MetricCard label="开放中" value={bugSummary.openCount} />
        <MetricCard label="严重缺陷" value={bugSummary.criticalCount} />
      </div>
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <SectionHeader eyebrow="Bug Registry" title="缺陷列表" />
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
                        <SelectItem value="OPEN">{formatBugStatus('OPEN')}</SelectItem>
                        <SelectItem value="CONFIRMED">{formatBugStatus('CONFIRMED')}</SelectItem>
                        <SelectItem value="FIXING">{formatBugStatus('FIXING')}</SelectItem>
                        <SelectItem value="FIXED">{formatBugStatus('FIXED')}</SelectItem>
                        <SelectItem value="VERIFIED">{formatBugStatus('VERIFIED')}</SelectItem>
                        <SelectItem value="CLOSED">{formatBugStatus('CLOSED')}</SelectItem>
                        <SelectItem value="WONT_FIX">{formatBugStatus('WONT_FIX')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedSeverity ?? '__all__'}
                      onValueChange={(value) => setSelectedSeverity(value === '__all__' ? undefined : value)}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="按严重级别筛选" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">全部严重级别</SelectItem>
                        <SelectItem value="LOW">{formatSeverity('LOW')}</SelectItem>
                        <SelectItem value="MEDIUM">{formatSeverity('MEDIUM')}</SelectItem>
                        <SelectItem value="HIGH">{formatSeverity('HIGH')}</SelectItem>
                        <SelectItem value="CRITICAL">{formatSeverity('CRITICAL')}</SelectItem>
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
        {pagedBugs.length > 0 ? (
          <>
            <div className="flex flex-col gap-3.5">
              {pagedBugs.map((item) => (
              <RecordListItem
                key={item.id}
                title={<div className="text-base font-semibold leading-6 text-foreground">{item.title}</div>}
                badges={
                  <>
                    <Badge variant="destructive">{formatSeverityLabel(item.severity)}</Badge>
                    <Badge variant="outline">{formatPriorityLabel(item.priority)}</Badge>
                    <Badge variant="secondary">{formatBugStatus(item.status)}</Badge>
                    <Badge variant="default">
                      {item.workspace?.name ?? '未绑定工作区'}
                    </Badge>
                  </>
                }
                description={<p className="leading-6">{item.description}</p>}
                details={
                  <>
                    <p className="text-sm leading-6 text-muted-foreground">来源需求：{item.requirement?.title ?? '未关联需求'}</p>
                    <p className="text-sm leading-6 text-muted-foreground">分支：{item.branchName ?? '未记录分支'}</p>
                  </>
                }
                actions={
                  <>
                    <UiButton variant="outline" asChild>
                      <Link to={`/bugs/${item.id}`}>查看详情</Link>
                    </UiButton>
                    {item.workflowRun?.id ? (
                      <UiButton variant="outline" asChild>
                        <Link to={`/workflow-runs/${item.workflowRun.id}`}>查看来源流程</Link>
                      </UiButton>
                    ) : null}
                  </>
                }
              />
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 mt-4 border-t border-border pt-4">
              <span className="text-sm text-muted-foreground">共 {filteredBugs.length} 条</span>
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
          <EmptyState description="当前还没有沉淀的缺陷，先在 AI 审查阶段录入缺陷。" />
        )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
