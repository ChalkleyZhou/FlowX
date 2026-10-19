import type { EvidenceType, ExecutionSessionDetail, ExecutionSessionEvidence, ExecutionSessionSyncEvent } from '../types';
import { formatExecutionTime } from '../utils/execution-session-ui';
import { DevelopmentProgressRow } from './DevelopmentProgressRow';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const resultGroups: Array<[EvidenceType, string]> = [
  ['AGENT_SUMMARY', '开发摘要'], ['GIT_COMMIT', '代码提交'], ['CHANGED_FILES', '变更文件'],
  ['TEST_RESULT', '测试结果'], ['BUILD_RESULT', '构建结果'],
  ['REMOTE_BRANCH_VERIFICATION', '远端分支检查'], ['USER_CONFIRMATION', '人工确认'],
];
const verification = {
  REPORTED: { label: '本地回报', tone: 'outline' },
  VERIFIED: { label: '已核验', tone: 'success' },
  REJECTED: { label: '核验未通过', tone: 'destructive' },
} as const;
const eventLabels: Record<string, string> = {
  'execution.claimed': '领取任务', 'execution.started': '开始开发',
  'execution.progressed': '进展更新', 'execution.blocked': '遇到阻塞',
  'execution.completion_requested': '提交开发结果', 'execution.completed': '开发完成',
  'execution.failed': '执行失败', 'execution.cancelled': '已取消',
};

function resultTitle(item: ExecutionSessionEvidence) {
  if (item.title === item.evidenceType) return resultGroups.find(([type]) => type === item.evidenceType)?.[1] ?? item.title;
  if (item.title === 'Local execution test result') return '本地测试回报';
  if (item.title === 'Local execution summary') return '开发内容摘要';
  if (item.evidenceType === 'GIT_COMMIT') return item.title.replace(/ commit [a-f0-9]+$/i, ' 的代码提交');
  if (item.evidenceType === 'CHANGED_FILES') return item.title.replace(/ changed files$/, ' 的文件变更');
  if (item.evidenceType === 'REMOTE_BRANCH_VERIFICATION') return item.title.replace(/ remote branch verification$/, ' 的远端分支检查');
  return item.title;
}

function ResultRecord({ item }: { item: ExecutionSessionEvidence }) {
  const state = verification[item.status];
  const metadata = item.metadata ?? {};
  const branch = typeof metadata.workingBranch === 'string' ? metadata.workingBranch : null;
  const sha = typeof metadata.headSha === 'string' ? metadata.headSha : null;
  const files = Array.isArray(metadata.changedFiles) ? metadata.changedFiles.filter((file): file is string => typeof file === 'string') : [];
  const remoteCheck = item.evidenceType === 'REMOTE_BRANCH_VERIFICATION' && typeof metadata.verified === 'boolean';
  return <div className="min-w-0 space-y-2 rounded-md border border-border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="break-words font-medium">{resultTitle(item)}</div><Badge variant={state.tone}>{state.label}</Badge></div>
    {remoteCheck ? <p>{metadata.verified ? '远端分支与回传提交一致。' : '尚未完成远端分支核对。'}</p> : item.summary ? <p className="whitespace-pre-wrap break-words leading-6">{item.summary}</p> : !files.length && !sha ? <p className="text-muted-foreground">已收到记录，未附具体说明。</p> : null}
    {branch || sha ? <dl className="space-y-1 text-muted-foreground">
      {branch ? <div className="flex gap-2"><dt className="shrink-0">分支</dt><dd className="break-all font-mono">{branch}</dd></div> : null}
      {sha ? <div className="flex gap-2"><dt className="shrink-0">提交</dt><dd className="break-all font-mono">{sha}</dd></div> : null}
      {item.evidenceType === 'GIT_COMMIT' && typeof metadata.pushed === 'boolean' ? <div><dt className="inline">推送：</dt><dd className="inline">{metadata.pushed ? '已推送（本地回报）' : '尚未推送'}</dd></div> : null}
    </dl> : null}
    {files.length ? <details><summary className="cursor-pointer text-muted-foreground">查看 {files.length} 个变更文件</summary><ul className="mt-2 max-h-64 space-y-1 overflow-y-auto font-mono text-xs">{files.map((file, index) => <li key={`${index}:${file}`} className="break-all">{file}</li>)}</ul></details> : null}
    <time className="block text-xs text-muted-foreground" dateTime={item.occurredAt}>{formatExecutionTime(item.occurredAt)}</time>
  </div>;
}

function recentProgress(session: ExecutionSessionDetail, events: ExecutionSessionSyncEvent[]) {
  const unique = new Map<string, ExecutionSessionSyncEvent>();
  for (const event of [...events, ...(session.latestProgress ? [session.latestProgress] : [])]) {
    if (eventLabels[event.eventType]) unique.set(event.id ?? event.eventId ?? `${event.eventType}:${event.occurredAt}`, event);
  }
  return [...unique.values()].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 10);
}

export function DevelopmentProgressDetail({ session, evidence, events, loading, resultsUnavailable, eventsUnavailable }: {
  session: ExecutionSessionDetail;
  evidence: ExecutionSessionEvidence[];
  events: ExecutionSessionSyncEvent[];
  loading: boolean;
  resultsUnavailable: boolean;
  eventsUnavailable: boolean;
}) {
  const timeline = recentProgress(session, events);
  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(session.status);
  return <>
    <section aria-label="当前进展" className="space-y-3"><h2 className="text-base font-semibold">当前进展</h2><DevelopmentProgressRow detail session={{ ...session, syncEvents: events, evidence }} search="" /></section>
    <Card aria-label="最近进展" className="shadow-none">
      <CardHeader className="p-4 pb-3"><CardTitle className="text-base">最近进展</CardTitle><p className="text-sm text-muted-foreground">展示最近同步的开发进展和状态变化，最多 10 条。</p></CardHeader>
      <CardContent className="p-4 pt-0">
        {timeline.length ? <ol className="space-y-4 border-l border-border pl-4">{timeline.map((event) => {
          const message = [event.payload.summary, event.payload.message, event.payload.blockedReason, event.payload.errorMessage, event.payload.reason]
            .find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
          return <li key={event.id ?? event.eventId ?? `${event.eventType}:${event.occurredAt}`} className="space-y-1 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{eventLabels[event.eventType]}</span><time className="text-xs text-muted-foreground" dateTime={event.occurredAt}>{formatExecutionTime(event.occurredAt)}</time></div>
            {message ? <p className="whitespace-pre-wrap break-words leading-6">{message}</p> : <p className="text-muted-foreground">本地 Agent 未附具体说明。</p>}
          </li>;
        })}</ol> : <p className="text-sm text-muted-foreground">{loading ? '正在读取进展记录…' : eventsUnavailable ? '进展记录暂时无法读取，请刷新重试。' : '尚未收到具体进展记录；最近检查点仅表示本地有回报。'}</p>}
      </CardContent>
    </Card>
    <Card aria-label="开发结果" className="shadow-none">
      <CardHeader className="p-4 pb-3"><CardTitle className="text-base">开发结果</CardTitle><p className="text-sm leading-6 text-muted-foreground">本地 Agent 回传的开发摘要、代码提交、测试和构建记录。核验状态不代表测试是否通过，请以回报内容为准。</p></CardHeader>
      <CardContent className="space-y-5 p-4 pt-0">
        {evidence.length ? resultGroups.map(([type, label]) => {
          const items = evidence.filter((item) => item.evidenceType === type);
          return items.length ? <section key={type} className="space-y-2"><h3 className="text-sm font-semibold">{label}<span className="ml-2 font-normal text-muted-foreground">{items.length} 条</span></h3><div className={items.length > 1 ? 'grid items-start gap-3 xl:grid-cols-2' : 'grid gap-3'}>{items.map((item) => <ResultRecord key={item.id} item={item} />)}</div></section> : null;
        }) : <p className="text-sm leading-6 text-muted-foreground">{loading ? '正在读取开发结果…' : resultsUnavailable ? '开发结果暂时无法读取，请刷新重试。' : terminal ? '任务已结束，尚未收到开发结果，请到对应工作流查看产出或在本地确认回传情况。' : '任务仍在进行中，提交、测试和构建结果会在本地回传后显示。'}</p>}
      </CardContent>
    </Card>
    <details className="rounded-md border border-border bg-card p-4 text-sm">
      <summary className="cursor-pointer font-medium">技术信息</summary>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        {[
          ['最近检查点', formatExecutionTime(session.lastHeartbeatAt)], ['设备', session.deviceId || '尚未绑定'],
          ['创建时间', formatExecutionTime(session.createdAt)], ['开始时间', formatExecutionTime(session.startedAt)],
          ['结束时间', formatExecutionTime(session.completedAt)], ['会话 ID', session.id], ['追踪 ID', session.traceId],
        ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}
      </dl>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">检查点表示平台最近收到本地回报的时间，具体开发内容以进展记录和开发结果为准。</p>
    </details>
  </>;
}
