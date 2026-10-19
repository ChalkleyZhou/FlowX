import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { ExecutionSessionDetail } from '../types';
import { executionStatus, formatExecutionTime } from '../utils/execution-session-ui';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

const stageLabels: Record<ExecutionSessionDetail['status'], string> = {
  CREATED: '等待本地执行', CLAIMED: '等待本地执行', RUNNING: '开发执行中', BLOCKED: '等待处理',
  COMPLETING: '提交结果中', COMPLETED: '已完成', FAILED: '执行失败', CANCELLED: '已取消',
};
const toolLabels: Record<ExecutionSessionDetail['sourceTool'], string> = {
  codex: 'Codex', cursor: 'Cursor', opendesign: 'OpenDesign', shell: '命令行',
  'test-runner': '测试工具', 'flowx-worker': 'FlowX Worker',
};

function progress(session: ExecutionSessionDetail) {
  const summary = session.summary?.trim() || session.evidence?.find((item) => item.evidenceType === 'AGENT_SUMMARY')?.summary?.trim();
  if (session.status === 'COMPLETED') return { text: summary || '暂无完成摘要', time: session.completedAt };
  const event = session.latestProgress ?? session.syncEvents?.find((item) => item.eventType === 'execution.progressed');
  const text = event && [event.payload.summary, event.payload.message].find((value) => typeof value === 'string' && value.trim());
  return { text: typeof text === 'string' ? text : summary || session.stageExecution?.statusMessage?.trim() || '暂无进度回报',
    time: typeof text === 'string' ? event?.occurredAt : undefined };
}

function duration(session: ExecutionSessionDetail) {
  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(session.status);
  const start = new Date(session.startedAt || session.createdAt).getTime();
  const end = terminal ? new Date(session.completedAt || session.updatedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '暂无';
  const minutes = Math.max(0, Math.floor((end - start) / 60_000));
  if (minutes < 1) return '不足 1 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export function DevelopmentProgressRow({ session, search, detail = false }: { session: ExecutionSessionDetail; search: string; detail?: boolean }) {
  const status = executionStatus(session);
  const latest = progress(session);
  const attention = status.tone === 'warning' || status.tone === 'destructive';
  const test = session.evidence?.find((item) => item.evidenceType === 'TEST_RESULT');
  return <Card className="rounded-md border-border bg-card shadow-none">
    <CardContent className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2"><h2 className="break-words font-semibold">{session.workflowRun?.requirement.title ?? '未命名任务'}</h2><Badge variant={status.tone}>{stageLabels[session.status]}</Badge></div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground"><span>{session.project?.name ?? '未记录项目'}</span><span>{session.claimedByUser?.displayName ?? '未记录执行人'}</span><span>{toolLabels[session.sourceTool]}</span></div>
        </div>
        {!detail ? <Button asChild variant="outline" size="sm"><Link to={`/execution-sessions/${session.id}${search}`}>查看进展<ExternalLink /></Link></Button> : null}
      </div>
      {attention ? <p className="rounded-md bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">需关注：</span>{status.description}{session.health === 'STALE' && session.status !== 'BLOCKED' && !session.cancelRequestedAt ? `（${status.label}）` : ''}</p> : null}
      <div className="text-sm"><span className="text-muted-foreground">{session.status === 'COMPLETED' ? '完成摘要：' : '最近进展：'}</span><span className="whitespace-pre-wrap break-words">{latest.text}</span>{latest.time ? <span className="ml-2 text-xs text-muted-foreground">{formatExecutionTime(latest.time)}</span> : null}</div>
      {test ? <p className="break-words text-sm"><span className="text-muted-foreground">测试回报：</span>{test.summary || test.title}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-x-4 gap-y-1"><span>持续时间：{duration(session)}</span><span>最近回报：{formatExecutionTime(session.lastHeartbeatAt)}</span>{session.health === 'UNKNOWN' ? <span>尚无本地检查点，执行情况未知</span> : null}</div>
        {session.workflowRunId ? <Link className="text-primary hover:underline" to={`/workflow-runs/${session.workflowRunId}`}>{session.status === 'COMPLETED' ? '查看产出与审查' : '查看工作流'}</Link> : null}
      </div>
    </CardContent>
  </Card>;
}
