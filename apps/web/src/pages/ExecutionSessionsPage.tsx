import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { ExecutionControlActions } from '../components/ExecutionControlActions';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { executionStatus, formatExecutionTime } from '../utils/execution-session-ui';
import type { ExecutionSessionDetail, ExecutionSessionStatus, Project, SourceTool } from '../types';

const statuses: Array<[ExecutionSessionStatus, string]> = [
  ['RUNNING', '执行中'], ['BLOCKED', '等待处理'], ['COMPLETING', '提交中'],
  ['COMPLETED', '已完成'], ['FAILED', '失败'], ['CANCELLED', '已取消'],
];
const tools: Array<[SourceTool, string]> = [['cursor', 'Cursor'], ['codex', 'Codex'], ['opendesign', 'OpenDesign'], ['shell', '命令行'], ['test-runner', '测试工具'], ['flowx-worker', 'FlowX Worker']];

function StatusBadge({ session }: { session: ExecutionSessionDetail }) {
  const status = executionStatus(session);
  return <Badge variant={status.tone}>{status.label}</Badge>;
}

function SessionRow({ session, search }: { session: ExecutionSessionDetail; search: string }) {
  return <Card className="rounded-md border-border bg-card shadow-none">
    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="truncate font-semibold">{session.workflowRun?.requirement.title ?? '未命名任务'}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <StatusBadge session={session} />
          <span>{session.sourceTool === 'codex' ? 'Codex' : session.sourceTool === 'cursor' ? 'Cursor' : session.sourceTool}</span>
          <span>{session.claimedByUser?.displayName ?? '未记录执行人'}</span>
          <span>最近回报：{formatExecutionTime(session.lastHeartbeatAt)}</span>
        </div>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link to={`/execution-sessions/${session.id}${search}`}><span>查看详情</span><ExternalLink /></Link>
      </Button>
    </CardContent>
  </Card>;
}

export function ExecutionSessionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [rows, setRows] = useState<ExecutionSessionDetail[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const projectId = searchParams.get('projectId') ?? 'all';
  const status = searchParams.get('status') ?? 'all';
  const sourceTool = searchParams.get('sourceTool') ?? 'all';
  const cursor = searchParams.get('cursor') ?? undefined;

  useEffect(() => {
    let active = true;
    api.getProjects().then((items) => { if (active) setProjects(items); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function refresh() {
      if (inFlight) return;
      inFlight = true; setLoading(true);
      try {
        const result = await api.listExecutionSessions({
          projectId: projectId === 'all' ? undefined : projectId,
          status: status === 'all' ? undefined : status as ExecutionSessionStatus,
          sourceTool: sourceTool === 'all' ? undefined : sourceTool as SourceTool,
          cursor, take: 30,
        });
        if (active) { setRows(result.items); setNextCursor(result.nextCursor); setError(null); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '执行记录加载失败');
      } finally { inFlight = false; if (active) setLoading(false); }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId, status, sourceTool, cursor, revision]);

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete(key); else next.set(key, value);
    next.delete('cursor'); setSearchParams(next);
  }

  return <div className="space-y-5">
    <PageHeader eyebrow="运行中心" title="Agent 运行" description="这里汇总每个本地 Agent 任务。先看状态和最近回报，需要处理时再打开详情。" actions={<Button variant="outline" disabled={loading} onClick={() => setRevision((value) => value + 1)}><RefreshCw />刷新</Button>} />
    <div className="flex flex-wrap gap-3">
      <Select value={projectId} onValueChange={(value) => updateFilter('projectId', value)}><SelectTrigger className="w-48" aria-label="按项目筛选"><SelectValue placeholder="全部项目" /></SelectTrigger><SelectContent><SelectItem value="all">全部项目</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select>
      <Select value={status} onValueChange={(value) => updateFilter('status', value)}><SelectTrigger className="w-40" aria-label="按运行状态筛选"><SelectValue placeholder="全部状态" /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{statuses.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
      <Select value={sourceTool} onValueChange={(value) => updateFilter('sourceTool', value)}><SelectTrigger className="w-40" aria-label="按工具筛选"><SelectValue placeholder="全部工具" /></SelectTrigger><SelectContent><SelectItem value="all">全部工具</SelectItem>{tools.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
    </div>
    {error ? <div className="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>重试</Button></div> : null}
    {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取运行记录…</p> : null}
    {!loading && !error && !rows.length ? <EmptyState title="暂无执行记录" description="先打开一个工作流，在执行阶段点击“本地启动”，这里才会出现运行任务。" action={<Button asChild variant="outline"><Link to="/workflow-runs">查看工作流</Link></Button>} /> : null}
    {!error && rows.length ? <div className="space-y-3">{rows.map((row) => <SessionRow key={row.id} session={row} search={searchParams.toString() ? `?${searchParams.toString()}` : ''} />)}</div> : null}
    <div className="flex gap-2">{cursor ? <Button variant="outline" onClick={() => { const next = new URLSearchParams(searchParams); next.delete('cursor'); setSearchParams(next); }}>上一页</Button> : null}{nextCursor ? <Button variant="outline" disabled={loading} onClick={() => { const next = new URLSearchParams(searchParams); next.set('cursor', nextCursor); setSearchParams(next); }}>下一页</Button> : null}</div>
  </div>;
}

export function ExecutionSessionDetailPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState<ExecutionSessionDetail | null>(null);
  const [evidence, setEvidence] = useState<NonNullable<ExecutionSessionDetail['evidence']>>([]);
  const [events, setEvents] = useState<NonNullable<ExecutionSessionDetail['syncEvents']>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const listHref = `/execution-sessions${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

  const refresh = async () => {
    const current = ++request.current; setLoading(true);
    try {
      const next = await api.getExecutionSession(sessionId);
      if (current !== request.current) return;
      setSession(next);
      setError(null);

      const [evidenceResult, eventsResult] = await Promise.allSettled([
        api.listExecutionSessionEvidence(sessionId),
        api.listExecutionSessionEvents(sessionId, { take: 10 }),
      ]);
      if (current !== request.current) return;
      if (evidenceResult.status === 'fulfilled') setEvidence(evidenceResult.value);
      if (eventsResult.status === 'fulfilled') setEvents(eventsResult.value.items);
      if (evidenceResult.status === 'rejected' || eventsResult.status === 'rejected') {
        setError('运行状态已更新，但部分证据或事件暂时无法读取。');
      }
    } catch (cause) {
      if (current === request.current) setError(cause instanceof Error ? cause.message : '运行详情加载失败');
    } finally { if (current === request.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 30_000); return () => { request.current += 1; window.clearInterval(timer); }; }, [sessionId]);

  if (loading && !session) return <p role="status" className="text-sm text-muted-foreground">正在读取运行详情…</p>;
  if (error && !session) return <div className="space-y-4"><Button asChild variant="outline"><Link to={listHref}><ArrowLeft />返回运行列表</Link></Button><p role="alert" className="text-danger">{error}</p></div>;
  if (!session) return null;
  return <div className="space-y-5">
    <PageHeader eyebrow="运行详情" title={session.workflowRun?.requirement.title ?? 'Agent 运行'} description={`${session.sourceTool === 'codex' ? 'Codex' : session.sourceTool === 'cursor' ? 'Cursor' : session.sourceTool} · ${session.claimedByUser?.displayName ?? '未记录执行人'}`} actions={<div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to={listHref}><ArrowLeft />返回运行列表</Link></Button>{session.workflowRunId ? <Button asChild variant="outline"><Link to={`/workflow-runs/${session.workflowRunId}`}>打开工作流<ExternalLink /></Link></Button> : null}</div>} />
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    <ExecutionControlActions session={{ ...session, evidence, syncEvents: events }} onChanged={async (newId) => { if (newId) { navigate(`/execution-sessions/${newId}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`, { replace: true }); return; } await refresh(); }} loading={loading} />
  </div>;
}
