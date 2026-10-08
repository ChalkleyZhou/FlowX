import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/PageHeader';
import { ExecutionControlActions } from '../components/ExecutionControlActions';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import type { ExecutionSessionDetail, ExecutionSessionStatus, Project, SourceTool } from '../types';

const statuses: Array<[ExecutionSessionStatus, string]> = [
  ['CREATED', '待领取'], ['CLAIMED', '已领取'], ['RUNNING', '执行中'], ['BLOCKED', '阻塞'],
  ['COMPLETING', '提交中'], ['COMPLETED', '已完成'], ['FAILED', '失败'], ['CANCELLED', '已取消'],
];
export function ExecutionSessionsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('all');
  const [status, setStatus] = useState('all');
  const [tool, setTool] = useState('all');
  const [cursor, setCursor] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [rows, setRows] = useState<ExecutionSessionDetail[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<ExecutionSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const detailRequest = useRef(0);

  useEffect(() => {
    let active = true;
    api.getProjects().then((data) => { if (active) setProjects(data); }).catch(() => {
      if (active) setError('项目列表加载失败，可刷新后重试。');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const result = await api.listExecutionSessions({
          projectId: projectId === 'all' ? undefined : projectId,
          status: status === 'all' ? undefined : status as ExecutionSessionStatus,
          sourceTool: tool === 'all' ? undefined : tool as SourceTool, cursor, take: 30,
        });
        if (active) { setRows(result.items); setNextCursor(result.nextCursor); setError(null); }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : '加载执行会话失败');
      } finally { inFlight = false; if (active) setLoading(false); }
    }
    setRows([]);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId, status, tool, cursor, revision]);

  useEffect(() => {
    const request = ++detailRequest.current;
    setDetail(null);
    setDetailError(null);
    if (!selectedId) return;
    let inFlight = false;
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await api.getExecutionSession(selectedId!);
        if (detailRequest.current === request) { setDetail(result); setDetailError(null); }
      } catch (error) {
        if (detailRequest.current === request) setDetailError(error instanceof Error ? error.message : '读取执行会话失败');
      } finally { inFlight = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { ++detailRequest.current; window.clearInterval(timer); };
  }, [selectedId, revision]);

  function filter(set: (value: string) => void, value: string) {
    set(value); setCursor(undefined); setSelectedId(undefined);
  }
  return <div className="space-y-5">
    <PageHeader eyebrow="Execution" title="Agent 运行" description="查看本地执行、阻塞和控制回执。每 30 秒刷新；失联表示未收到检查点，不代表本地进程已经停止。" />
    <div className="flex flex-wrap items-center gap-3">
      <Select value={projectId} onValueChange={(value) => filter(setProjectId, value)}><SelectTrigger className="w-48" aria-label="按项目筛选"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="all">全部项目</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
      </SelectContent></Select>
      <Select value={status} onValueChange={(value) => filter(setStatus, value)}><SelectTrigger className="w-40" aria-label="按状态筛选"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="all">全部状态</SelectItem>{statuses.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
      </SelectContent></Select>
      <Select value={tool} onValueChange={(value) => filter(setTool, value)}><SelectTrigger className="w-40" aria-label="按工具筛选"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="all">全部工具</SelectItem>{['cursor', 'codex', 'opendesign', 'shell', 'test-runner', 'flowx-worker'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
      </SelectContent></Select>
      <Button variant="outline" disabled={loading} onClick={() => setRevision((value) => value + 1)}>刷新列表</Button>
    </div>
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    {loading ? <p role="status">正在加载运行记录…</p> : null}
    {!loading && !error && !rows.length ? <p className="text-muted-foreground">当前筛选下没有执行会话。</p> : null}
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="space-y-3">{rows.map((row) => <Card key={row.id}><CardContent className="space-y-2 p-4">
        <div className="font-semibold">{row.workflowRun?.requirement.title ?? '执行会话'}</div>
        <p className="text-sm">{statuses.find(([status]) => status === row.status)?.[1] ?? row.status} · {row.sourceTool} · {row.claimedByUser?.displayName ?? '未记录执行人'}</p>
        {row.health === 'STALE' ? <p className="text-sm text-amber-700">失联，待检查本地任务</p> : null}
        {row.cancelRequestedAt && !['CANCELLED', 'COMPLETED', 'FAILED'].includes(row.status) ? <p className="text-sm text-amber-700">等待本地取消回执</p> : null}
        {row.blockedReason ? <p className="text-sm">{row.blockedReason}</p> : null}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setSelectedId(row.id)}>查看运行</Button>
          {row.workflowRunId ? <Link className="text-sm text-primary" to={`/workflow-runs/${row.workflowRunId}`}>打开工作流</Link> : null}
        </div>
      </CardContent></Card>)}</div>
      <div>{detailError ? <p role="alert" className="text-destructive">{detailError}</p> : null}
        {selectedId && !detail && !detailError ? <p role="status">正在加载会话…</p> : null}
        {detail ? <ExecutionControlActions key={detail.id} session={detail} onChanged={(newId) => {
          if (newId) setSelectedId(newId);
          setRevision((value) => value + 1);
        }} /> : null}
      </div>
    </div>
    <div className="flex gap-2">
      {cursor ? <Button variant="outline" onClick={() => setCursor(undefined)}>返回第一页</Button> : null}
      {nextCursor ? <Button variant="outline" disabled={loading} onClick={() => setCursor(nextCursor)}>下一页</Button> : null}
    </div>
  </div>;
}
