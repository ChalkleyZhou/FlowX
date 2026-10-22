import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { WorkflowCollaboration } from '../utils/workflow-collaboration';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Textarea } from './ui/textarea';

interface WorkflowCollaborationPanelProps {
  workflowRunId: string;
  workflowStatus: string;
  currentStage: string;
  currentStageLabel: string;
  stageExecutionId?: string;
  stageStatus?: string;
  onReleased: () => void | Promise<unknown>;
}

const nextStageLabels: Record<string, string> = {
  REPOSITORY_GROUNDING: '完成后进入产品构思。',
  BRAINSTORM: '确认后进入设计方案。',
  DESIGN: '确认后进入 Spec & Plan。',
  SPEC_PLAN: '确认后进入开发执行。',
  EXECUTION: '完成后进入 AI 审查。',
  AI_REVIEW: '审查后进入人工评审。',
  HUMAN_REVIEW: '确认通过后完成工作流，可继续发起提测。',
};

export function WorkflowCollaborationPanel(props: WorkflowCollaborationPanelProps) {
  const { workflowRunId, workflowStatus, currentStage, currentStageLabel, stageExecutionId, stageStatus } = props;
  const [snapshot, setSnapshot] = useState<{ id: string; data: WorkflowCollaboration | null; error: string | null }>({ id: workflowRunId, data: null, error: null });
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [confirmedStopped, setConfirmedStopped] = useState(false);
  const [reason, setReason] = useState('');
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const routeRef = useRef(workflowRunId);
  routeRef.current = workflowRunId;
  const terminal = ['DONE', 'FAILED', 'CANCELLED', 'CANCELED'].includes(workflowStatus);

  useEffect(() => {
    let cancelled = false;
    let pending: Promise<void> | null = null;
    const load = (): Promise<void> => {
      if (pending) return pending;
      pending = (async () => {
        try {
          const data = await api.getWorkflowCollaboration(workflowRunId);
          if (!cancelled) setSnapshot({ id: workflowRunId, data, error: null });
        } catch (error) {
          if (!cancelled) setSnapshot(previous => ({ id: workflowRunId, data: previous.id === workflowRunId ? previous.data : null, error: error instanceof Error ? error.message : '协作状态加载失败' }));
        } finally {
          pending = null;
        }
      })();
      return pending;
    };
    refreshRef.current = load;
    void load();
    const timer = terminal ? null : window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [workflowRunId, terminal, stageExecutionId, stageStatus]);

  useEffect(() => {
    setReleaseOpen(false); setConfirmedStopped(false); setReason(''); setReleaseError(null); setReleasing(false);
  }, [workflowRunId, stageExecutionId]);

  const data = snapshot.id === workflowRunId ? snapshot.data : null;
  const error = snapshot.id === workflowRunId ? snapshot.error : null;
  const session = data?.sessions.find(item => item.stage === currentStage && item.stageExecutionId === stageExecutionId);
  const humanReviewPending = workflowStatus === 'HUMAN_REVIEW_PENDING';
  const received = stageStatus === 'WAITING_CONFIRMATION' || humanReviewPending || ['DESIGN_WAITING_CONFIRMATION', 'SPEC_PLAN_WAITING_CONFIRMATION'].includes(workflowStatus);
  const failed = workflowStatus === 'FAILED' || stageStatus === 'FAILED' || session?.status === 'FAILED' || session?.status === 'REJECTED';
  const cancelled = ['CANCELLED', 'CANCELED'].includes(workflowStatus) || session?.status === 'CANCELLED' || session?.status === 'CANCELED';
  const cooperative = session?.controlMode === 'COOPERATIVE';
  const recent = cooperative && session?.health === 'ONLINE';
  const stale = cooperative && session?.health === 'STALE';
  const sessionComplete = session?.status === 'COMPLETED';
  const label = workflowStatus === 'DONE' ? '工作流已完成'
    : humanReviewPending ? '待人工评审' : received ? '已回传，待平台确认'
      : failed ? '执行失败'
        : cancelled ? '本次本地任务已结束'
          : sessionComplete ? '已回传，等待平台处理'
            : session ? stale ? '长时间未回报' : recent ? '最近收到本地回报' : '已领取，待本地回报'
              : stageStatus === 'RUNNING' ? '阶段处理中，执行位置待确认' : stageStatus === 'COMPLETED' ? '阶段已完成' : '待执行';
  const nextAction = workflowStatus === 'DONE' ? '工作流已完成，可查看产物并继续质量流程。' : received ? '请查看下方产物并完成人工确认。'
    : failed ? '请查看错误信息，在下方阶段操作中重试。'
      : sessionComplete ? '平台已收到产物，请刷新查看处理结果。'
        : cancelled ? '旧会话已结束，可在下方重新领取并交接。'
          : session ? stale ? '请联系当前执行人核对原设备；失联不代表本地已停止。'
            : '等待当前执行人完成本地任务并回传产物。'
            : stageStatus === 'RUNNING' ? '平台已记录阶段执行中，执行位置与运行情况以实际回报为准。' : '请从下方当前阶段操作开始。';
  const mayRelease = !received && !sessionComplete && session?.canRelease && ['BRAINSTORM', 'DESIGN', 'SPEC_PLAN'].includes(currentStage);

  async function release() {
    if (!session || !mayRelease || !confirmedStopped || !reason.trim() || releasing) return;
    const requestId = workflowRunId;
    setReleasing(true); setReleaseError(null);
    try {
      await api.releaseWorkflowLocalTask(requestId, { executionSessionId: session.id, confirmedStopped: true, reason: reason.trim() });
      if (routeRef.current !== requestId) return;
      setReleaseOpen(false);
      await Promise.all([refreshRef.current(), props.onReleased()]);
    } catch (error) {
      if (routeRef.current === requestId) setReleaseError(error instanceof Error ? error.message : '结束本地任务失败');
    } finally {
      if (routeRef.current === requestId) setReleasing(false);
    }
  }

  return (
    <Card data-testid="workflow-current-task" className="border-primary/30 bg-card">
      <CardHeader className="gap-2 p-5 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">当前任务 · {currentStageLabel}</h2>
          <div className="flex items-center gap-2"><Badge variant={failed ? 'destructive' : received || stale ? 'warning' : 'secondary'}>{label}</Badge><Button size="sm" variant="ghost" onClick={() => void refreshRef.current()}>刷新协作状态</Button></div>
        </div>
        <p className="text-sm text-muted-foreground">{nextAction} {terminal ? '' : nextStageLabels[currentStage]}</p>
      </CardHeader>
      <CardContent className="space-y-3 p-5 pt-0">
        {session ? <>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-muted-foreground">当前执行人</dt><dd className="mt-1 font-medium">{session.claimedByUser?.displayName ?? '未记录执行人'}{session.isOwner ? '（我）' : ''}</dd></div>
            <div><dt className="text-muted-foreground">执行位置</dt><dd className="mt-1 font-medium">本地设备{session.deviceId ? ` · ${session.deviceId}` : ''}{session.sourceTool ? ` / ${session.sourceTool}` : ''}</dd></div>
            <div><dt className="text-muted-foreground">本地最近回报</dt><dd className="mt-1 font-medium">{cooperative && session.health !== 'UNKNOWN' && session.lastHeartbeatAt ? new Date(session.lastHeartbeatAt).toLocaleString('zh-CN') : '尚未确认本地运行状态'}</dd></div>
          </dl>
          {session.summary ? <p className="text-sm">{session.summary}</p> : null}
          {session.blockedReason ? <p className="text-sm text-warning">{session.blockedReason}</p> : null}
          {session.errorMessage ? <p className="text-sm text-destructive">{session.errorMessage}</p> : null}
          {mayRelease ? <Button size="sm" variant="outline" onClick={() => { setReleaseError(null); setConfirmedStopped(false); setReason(''); setReleaseOpen(true); }}>结束本次本地任务</Button> : null}
        </> : !data && !error ? <p className="text-sm text-muted-foreground">正在读取端云协作状态…</p> : <p className="text-sm text-muted-foreground">当前阶段尚无本地领取记录。</p>}
        {error ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void refreshRef.current()}>重试协作状态</Button></div> : null}
      </CardContent>
      <Dialog open={releaseOpen} onOpenChange={open => { if (!releasing) setReleaseOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>结束本次本地任务并重新交接</DialogTitle><DialogDescription>此操作仅结束平台会话，不能远程关闭 IDE。请先在原设备停止任务；结束后旧会话将不能继续回传，其他成员可重新领取。</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={event => { event.preventDefault(); void release(); }}>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmedStopped} onChange={event => setConfirmedStopped(event.target.checked)} disabled={releasing} />我已确认原设备上的任务已停止</label>
            <label className="block space-y-2 text-sm"><span>结束原因（必填）</span><Textarea value={reason} onChange={event => setReason(event.target.value)} disabled={releasing} required maxLength={1000} /></label>
            {releaseError ? <p role="alert" className="text-sm text-destructive">{releaseError}</p> : null}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setReleaseOpen(false)} disabled={releasing}>取消</Button><Button type="submit" disabled={!confirmedStopped || !reason.trim() || releasing}>{releasing ? '结束中…' : '结束任务并重新交接'}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
