import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { DevelopmentProgressRow } from '../components/DevelopmentProgressRow';
import { DevelopmentOverview } from '../components/DevelopmentOverview';
import { DevelopmentProgressDetail } from '../components/DevelopmentProgressDetail';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import type { ExecutionSessionDetail, ExecutionSessionStatus, ExecutionSessionView, OrganizationMember, Project, SourceTool } from '../types';

const statuses: Array<[ExecutionSessionStatus, string]> = [
  ['CREATED', '待启动'], ['CLAIMED', '已领取'], ['RUNNING', '执行中'], ['BLOCKED', '等待处理'],
  ['COMPLETING', '提交中'], ['COMPLETED', '已完成'], ['FAILED', '失败'], ['CANCELLED', '已取消'],
];
const tools: Array<[SourceTool, string]> = [['cursor', 'Cursor'], ['codex', 'Codex'], ['opendesign', 'OpenDesign'], ['shell', '命令行'], ['test-runner', '测试工具'], ['flowx-worker', 'FlowX Worker']];
const views: Array<[ExecutionSessionView, string]> = [['active', '进行中'], ['attention', '需关注'], ['completed', '已完成'], ['all', '全部']];
const PAGE_SIZE = 20;

function Filter({ label, value, allLabel, items, onChange }: {
  label: string; value: string; allLabel: string; items: Array<[string, string]>; onChange: (value: string) => void;
}) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger className="w-full sm:w-40" aria-label={label}><SelectValue placeholder={allLabel} /></SelectTrigger><SelectContent><SelectItem value="all">{allLabel}</SelectItem>{items.map(([key, name]) => <SelectItem key={key} value={key}>{name}</SelectItem>)}</SelectContent></Select>;
}

export function ExecutionSessionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [optionsError, setOptionsError] = useState(false);
  const [rows, setRows] = useState<ExecutionSessionDetail[]>([]);
  const [counts, setCounts] = useState<Record<ExecutionSessionView, number> | null>(null);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const projectId = searchParams.get('projectId') ?? 'all';
  const status = searchParams.get('status') ?? 'all';
  const sourceTool = searchParams.get('sourceTool') ?? 'all';
  const claimedByUserId = searchParams.get('claimedByUserId') ?? 'all';
  const search = searchParams.get('search')?.trim() ?? '';
  const [searchDraft, setSearchDraft] = useState(search);
  const rawView = searchParams.get('view');
  const view: ExecutionSessionView = views.find(([key]) => key === rawView)?.[0] ?? (status !== 'all' ? 'all' : 'active');
  const rawPage = Number(searchParams.get('page') ?? 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 1_000_000 ? rawPage : 1;
  const query = searchParams.toString();

  useEffect(() => setSearchDraft(search), [search]);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([api.getProjects(), api.getOrganizationMembers()]).then(([projectResult, memberResult]) => {
      if (!active) return;
      if (projectResult.status === 'fulfilled') setProjects(projectResult.value);
      if (memberResult.status === 'fulfilled') setMembers(memberResult.value);
      setOptionsError(projectResult.status === 'rejected' || memberResult.status === 'rejected');
    });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function refresh(options?: { silent?: boolean }) {
      if (inFlight) return;
      inFlight = true;
      if (!options?.silent) setLoading(true);
      try {
        const result = await api.listExecutionSessions({
          projectId: projectId === 'all' ? undefined : projectId,
          status: status === 'all' ? undefined : status as ExecutionSessionStatus,
          sourceTool: sourceTool === 'all' ? undefined : sourceTool as SourceTool,
          claimedByUserId: claimedByUserId === 'all' ? undefined : claimedByUserId,
          search: search || undefined, view, page, take: PAGE_SIZE,
        });
        if (active) {
          setRows(result.items);
          setCounts(result.counts ?? null);
          setPagination({ total: result.total ?? result.items.length, page: result.page ?? page, totalPages: result.totalPages ?? 1 });
          setError(null);
          if (result.page !== undefined && result.page !== page) {
            const next = new URLSearchParams(query);
            next.set('page', String(result.page));
            setSearchParams(next, { replace: true });
          }
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '开发进展加载失败');
      } finally {
        inFlight = false;
        if (active && !options?.silent) setLoading(false);
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh({ silent: true }), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId, status, sourceTool, claimedByUserId, search, view, page, query, revision, setSearchParams]);

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if ((value === 'all' && key !== 'view') || !value) next.delete(key); else next.set(key, value);
    // 快捷视图已经表达状态范围，切换时清除旧的精确状态，避免筛选互相抵消。
    if (key === 'view') next.delete('status');
    next.delete('page'); next.delete('cursor'); setSearchParams(next);
  }
  function changePage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(nextPage)); next.delete('cursor'); setSearchParams(next);
  }
  const pageNumbers = [...new Set([1, pagination.totalPages, pagination.page - 1, pagination.page, pagination.page + 1])]
    .filter((number) => number >= 1 && number <= pagination.totalPages).sort((a, b) => a - b);

  return <div className="space-y-5">
    <PageHeader eyebrow="Dashboard" title="研发看板" description="查看并行开发的整体情况，优先关注阻塞和异常。每 30 秒自动更新，具体开发操作在本地完成。" actions={<Button variant="outline" disabled={loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw />刷新</Button>} />
    <DevelopmentOverview counts={counts} view={view} onChange={(value) => updateFilter('view', value)} />
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        <Filter label="按项目筛选" value={projectId} allLabel="全部项目" items={projects.map((project) => [project.id, project.name])} onChange={(value) => updateFilter('projectId', value)} />
        <Filter label="按执行人筛选" value={claimedByUserId} allLabel="全部执行人" items={members.map((member) => [member.id, member.displayName])} onChange={(value) => updateFilter('claimedByUserId', value)} />
        <Filter label="按工具筛选" value={sourceTool} allLabel="全部工具" items={tools} onChange={(value) => updateFilter('sourceTool', value)} />
        <Filter label="按运行状态筛选" value={status} allLabel="全部状态" items={statuses} onChange={(value) => updateFilter('status', value)} />
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); updateFilter('search', searchDraft.trim()); }}>
        <Input className="min-w-40 flex-1" aria-label="搜索需求名称" placeholder="搜索需求名称" value={searchDraft} maxLength={200} onChange={(event) => setSearchDraft(event.target.value)} />
        <Button type="submit" variant="outline">搜索</Button><Button type="button" variant="ghost" onClick={() => { setSearchDraft(''); setSearchParams({}); }}>清除筛选</Button>
      </form>
      {optionsError ? <p className="text-sm text-muted-foreground">部分筛选选项暂时无法读取，可点击刷新重试。</p> : null}
    </div>
    {error ? <div className="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>重试</Button></div> : null}
    {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取运行记录…</p> : null}
    {!loading && !error && !rows.length ? <EmptyState title="没有匹配的开发任务" description="可以调整筛选，或到工作流查看需求。本地开发执行启动后，进展会汇总到这里。" action={<Button asChild variant="outline"><Link to="/workflow-runs">查看工作流</Link></Button>} /> : null}
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">{views.find(([key]) => key === view)?.[1]}的开发任务</h2><p className="text-xs text-muted-foreground">概览按项目、执行人、工具和搜索统计；任务卡片异常优先</p></div>
    {rows.length ? <div className="grid items-start gap-4 2xl:grid-cols-2" aria-busy={loading}>{rows.map((row) => <DevelopmentProgressRow key={row.id} session={row} search={query ? `?${query}` : ''} />)}</div> : null}
    <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="开发任务分页">
      <p className="text-sm text-muted-foreground">共 {pagination.total} 条 · 每页 {PAGE_SIZE} 条 · 第 {pagination.page} / {pagination.totalPages} 页</p>
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="outline" size="sm" disabled={loading || pagination.page <= 1} onClick={() => changePage(pagination.page - 1)}>上一页</Button>
        {pageNumbers.map((number, index) => <span key={number} className="flex items-center gap-1">{index > 0 && number - pageNumbers[index - 1] > 1 ? <span className="px-1 text-muted-foreground">…</span> : null}<Button variant={pagination.page === number ? 'default' : 'outline'} size="sm" aria-label={`第 ${number} 页`} aria-current={pagination.page === number ? 'page' : undefined} disabled={loading} onClick={() => changePage(number)}>{number}</Button></span>)}
        <Button variant="outline" size="sm" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => changePage(pagination.page + 1)}>下一页</Button>
      </div>
    </nav>
  </div>;
}

export function ExecutionSessionDetailPage() {
  const { sessionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState<ExecutionSessionDetail | null>(null);
  const [evidence, setEvidence] = useState<NonNullable<ExecutionSessionDetail['evidence']>>([]);
  const [events, setEvents] = useState<NonNullable<ExecutionSessionDetail['syncEvents']>>([]);
  const [resultsUnavailable, setResultsUnavailable] = useState(false);
  const [eventsUnavailable, setEventsUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const inFlight = useRef(false);
  const terminal = useRef(false);
  const listHref = `/dashboard${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

  const refresh = async (options?: { silent?: boolean }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = ++request.current;
    if (!options?.silent) setLoading(true);
    try {
      const next = await api.getExecutionSession(sessionId);
      if (current !== request.current) return;
      setSession(next);
      if (next.evidence) setEvidence(next.evidence);
      if (next.syncEvents) setEvents(next.syncEvents);
      terminal.current = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(next.status);
      setError(null);
      const [evidenceResult, eventsResult] = await Promise.allSettled([
        api.listExecutionSessionEvidence(sessionId), api.listExecutionSessionEvents(sessionId, { take: 10, view: 'progress' }),
      ]);
      if (current !== request.current) return;
      if (evidenceResult.status === 'fulfilled') setEvidence(evidenceResult.value);
      if (eventsResult.status === 'fulfilled') setEvents(eventsResult.value.items);
      setResultsUnavailable(evidenceResult.status === 'rejected');
      setEventsUnavailable(eventsResult.status === 'rejected');
      if (evidenceResult.status === 'rejected' || eventsResult.status === 'rejected') setError('当前进展已更新，但部分开发结果或进展记录暂时无法读取。');
    } catch (cause) {
      if (current === request.current) setError(cause instanceof Error ? cause.message : '运行详情加载失败');
    } finally {
      if (current === request.current) { inFlight.current = false; if (!options?.silent) setLoading(false); }
    }
  };
  useEffect(() => {
    terminal.current = false;
    setSession(null); setEvidence([]); setEvents([]); setResultsUnavailable(false); setEventsUnavailable(false);
    void refresh();
    const timer = window.setInterval(() => { if (!terminal.current) void refresh({ silent: true }); }, 30_000);
    return () => { request.current += 1; inFlight.current = false; window.clearInterval(timer); };
  }, [sessionId]);

  if (loading && !session) return <p role="status" className="text-sm text-muted-foreground">正在读取运行详情…</p>;
  if (error && !session) return <div className="space-y-4"><Button asChild variant="outline"><Link to={listHref}><ArrowLeft />返回看板</Link></Button><p role="alert" className="text-danger">{error}</p><Button variant="outline" onClick={() => void refresh()}>重试</Button></div>;
  if (!session) return null;
  return <div className="space-y-5">
    <PageHeader eyebrow="开发进展详情" title={session.workflowRun?.requirement.title ?? '开发进展'} description="查看当前推进情况、最近进展和本地回传的开发结果。" actions={<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading} onClick={() => void refresh()}><RefreshCw />刷新</Button><Button asChild variant="outline"><Link to={listHref}><ArrowLeft />返回看板</Link></Button>{session.workflowRunId ? <Button asChild variant="outline"><Link to={`/workflow-runs/${session.workflowRunId}`}>打开工作流<ExternalLink /></Link></Button> : null}</div>} />
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    <DevelopmentProgressDetail session={session} evidence={evidence} events={events} loading={loading} resultsUnavailable={resultsUnavailable} eventsUnavailable={eventsUnavailable} />
  </div>;
}
