import { RefreshCw } from 'lucide-react';
import type {
  ExecutionSessionDetail,
  ExecutionSessionEvidence,
  ExecutionSessionSyncEvent,
} from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

type Props = {
  session: ExecutionSessionDetail | null;
  evidence: ExecutionSessionEvidence[];
  events?: ExecutionSessionSyncEvent[];
  loading?: boolean;
  onRefresh?: () => void;
};

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '暂无';
}

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'destructive' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'FAILED' || status === 'CANCELLED') return 'destructive';
  if (status === 'RUNNING' || status === 'CLAIMED' || status === 'COMPLETING') return 'warning';
  return 'default';
}

export function ExecutionSessionPanel({
  session,
  evidence,
  events = [],
  loading = false,
  onRefresh,
}: Props) {
  if (!session) {
    return null;
  }

  return (
    <Card className="rounded-md border-border bg-card shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4 p-5 pb-0">
        <div>
          <CardTitle className="text-base">执行会话</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">本地执行同步状态、证据与最近事件。</p>
        </div>
        {onRefresh ? (
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            刷新
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5 p-5 pt-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground">状态</div>
            <Badge className="mt-1" variant={statusVariant(session.status)}>
              {session.status}
            </Badge>
          </div>
          <div>
            <div className="text-muted-foreground">来源工具</div>
            <div className="mt-1 font-medium">{session.sourceTool}</div>
          </div>
          <div>
            <div className="text-muted-foreground">设备</div>
            <div className="mt-1 break-all font-medium">{session.deviceId || '暂无'}</div>
          </div>
          <div>
            <div className="text-muted-foreground">最近心跳</div>
            <div className="mt-1 font-medium">{formatTime(session.lastHeartbeatAt)}</div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-muted-foreground">Trace ID</div>
            <code className="mt-1 block break-all rounded-md bg-muted px-2 py-1 text-xs">{session.traceId}</code>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold">执行证据</h3>
          {evidence.length > 0 ? (
            <div className="mt-3 space-y-2">
              {evidence.map((item) => (
                <div key={item.id} className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{item.title}</span>
                    <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.evidenceType} · {item.sourceTool} · {formatTime(item.occurredAt)}
                  </div>
                  {item.summary ? <p className="mt-2 text-muted-foreground">{item.summary}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">当前没有已同步的执行证据。</p>
          )}
        </div>

        {events.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold">最近事件</h3>
            <div className="mt-3 space-y-2">
              {events.map((event) => (
                <div key={event.id} className="flex flex-wrap justify-between gap-2 text-sm">
                  <span>{event.eventType}</span>
                  <span className="text-muted-foreground">{formatTime(event.occurredAt)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
