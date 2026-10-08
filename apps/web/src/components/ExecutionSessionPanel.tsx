import { RefreshCw } from 'lucide-react';
import type { ExecutionCommandType, ExecutionSessionDetail, ExecutionSessionEvidence, ExecutionSessionSyncEvent } from '../types';
import { executionStatus, formatExecutionTime } from '../utils/execution-session-ui';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

type Props = {
  session: ExecutionSessionDetail | null;
  evidence: ExecutionSessionEvidence[];
  events?: ExecutionSessionSyncEvent[];
  loading?: boolean;
  onRefresh?: () => void;
  onCommand?: (type: ExecutionCommandType) => void;
  onRetry?: () => void;
  actionPending?: boolean;
  error?: string | null;
};

const commandNames: Record<ExecutionCommandType, string> = { CANCEL: '停止任务', RESUME: '继续任务', REQUEST_SYNC: '重新同步' };
const commandStatuses: Record<string, string> = { CREATED: '等待 Agent 领取', DELIVERED: 'Agent 已领取，等待结果', ACKED: '已处理', FAILED: '处理失败', EXPIRED: '已失效' };

function eventName(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes('heartbeat')) return '检查点';
  if (normalized.includes('progress')) return '进度更新';
  if (normalized.includes('started')) return '开始执行';
  if (normalized.includes('completed')) return '提交完成';
  return '运行事件';
}

export function ExecutionSessionPanel({ session, evidence, events = [], loading = false, onRefresh, onCommand, onRetry, actionPending = false, error }: Props) {
  if (!session) return null;
  const status = executionStatus(session);
  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(session.status);
  const pendingCommand = session.commands?.some((item) => ['CREATED', 'DELIVERED'].includes(item.status));
  const needsAttention = status.tone === 'warning' || status.tone === 'destructive';

  return <Card className="rounded-md border-border bg-card shadow-none">
    <CardHeader className="flex flex-row items-start justify-between gap-4 p-5 pb-0">
      <div><CardTitle className="text-base">{needsAttention ? '需要处理' : '运行状态'}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{status.description}</p></div>
      {onRefresh ? <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />刷新</Button> : null}
    </CardHeader>
    <CardContent className="space-y-5 p-5 pt-4">
      {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3"><Badge variant={status.tone}>{status.label}</Badge><span className="text-sm text-muted-foreground">{session.sourceTool === 'codex' ? 'Codex' : session.sourceTool === 'cursor' ? 'Cursor' : session.sourceTool}</span><span className="text-sm text-muted-foreground">设备：{session.deviceId || '尚未绑定'}</span></div>
      {session.canControl ? <div className="flex flex-wrap gap-2">
        {!terminal && onCommand ? <>
          <Button size="sm" variant="outline" disabled={actionPending || (Boolean(session.cancelRequestedAt) && pendingCommand)} onClick={() => onCommand('CANCEL')}>请求停止</Button>
          {session.status === 'BLOCKED' ? <Button size="sm" variant="outline" disabled={actionPending || pendingCommand || Boolean(session.cancelRequestedAt)} onClick={() => onCommand('RESUME')}>请求继续</Button> : null}
          <Button size="sm" variant="outline" disabled={actionPending || pendingCommand || Boolean(session.cancelRequestedAt)} onClick={() => onCommand('REQUEST_SYNC')}>请求同步</Button>
        </> : null}
        {onRetry && (session.health === 'STALE' || ['FAILED', 'CANCELLED'].includes(session.status)) ? <Button size="sm" variant="outline" disabled={actionPending} onClick={onRetry}>重新交接</Button> : null}
      </div> : null}
      {session.cancelRequestedAt && session.health === 'STALE' ? <p className="text-sm text-warning">本地 Agent 已超过 5 分钟无回报，停止请求可能尚未收到。</p> : null}
      {session.commands?.length ? <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3"><h3 className="text-sm font-semibold">最近操作</h3>{session.commands.map((command) => <div key={command.id} className="text-sm"><span className="font-medium">{commandNames[command.commandType]}</span><span className="text-muted-foreground"> · {commandStatuses[command.status] ?? command.status}</span>{command.errorMessage ? <p className="text-danger">{command.errorMessage}</p> : null}</div>)}</div> : null}
      <div className="grid gap-3 text-sm sm:grid-cols-2"><div><div className="text-muted-foreground">最近回报</div><div className="mt-1 font-medium">{formatExecutionTime(session.lastHeartbeatAt)}</div></div><div><div className="text-muted-foreground">执行人</div><div className="mt-1 font-medium">{session.claimedByUser?.displayName ?? '未记录'}</div></div></div>
      <div><h3 className="text-sm font-semibold">完成证据{evidence.length ? `（${evidence.length} 条）` : ''}</h3>{evidence.length ? <div className="mt-2 space-y-2">{evidence.map((item) => <div key={item.id} className="rounded-md border border-border p-3 text-sm"><div className="font-medium">{item.title}</div>{item.summary ? <p className="mt-1 text-muted-foreground">{item.summary}</p> : null}</div>)}</div> : <p className="mt-1 text-sm text-muted-foreground">暂时没有回传完成证据。</p>}</div>
      {events.length ? <div><h3 className="text-sm font-semibold">最近事件</h3><div className="mt-2 space-y-1 text-sm text-muted-foreground">{events.slice(0, 5).map((event) => <div key={event.id} className="flex justify-between gap-3"><span>{eventName(event.eventType)}</span><span>{formatExecutionTime(event.occurredAt)}</span></div>)}</div></div> : null}
    </CardContent>
  </Card>;
}
