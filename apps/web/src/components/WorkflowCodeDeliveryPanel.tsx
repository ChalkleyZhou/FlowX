interface Props {
  workflowRunId: string;
  workflowStatus: string;
  onChanged: () => void | Promise<unknown>;
}

export function WorkflowCodeDeliveryPanel(props: Props) {
  // 整体隔离加载、表单与提交生命周期，旧路由回包不能更新新工作流。
  return <CodeDeliveryContent key={props.workflowRunId} {...props} />;
}

function CodeDeliveryContent({ workflowRunId, workflowStatus, onChanged }: Props) {
  const [data, setData] = useState<WorkflowCodeDelivery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [repositoryId, setRepositoryId] = useState('');
  const [branch, setBranch] = useState('');
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState<Record<string, { id: string; headSha: string }>>({});
  const [confirmRows, setConfirmRows] = useState<CodeBranchSubmission[] | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const mounted = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const writable = workflowStatus === 'EXECUTION_PENDING' || workflowStatus === 'EXECUTION_RUNNING';

  const refresh = useCallback((): Promise<void> => {
    if (pending.current) return pending.current;
    const request = ++generation.current;
    setLoading(true);
    pending.current = (async () => {
      try {
        const result = await api.getCodeDelivery(workflowRunId);
        if (mounted.current && generation.current === request) { setData(result); setError(null); }
      } catch (cause) {
        if (mounted.current && generation.current === request) setError(cause instanceof Error ? cause.message : '代码交付加载失败');
      } finally {
        if (mounted.current && generation.current === request) setLoading(false);
        pending.current = null;
      }
    })();
    return pending.current;
  }, [workflowRunId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; generation.current += 1; };
  }, [refresh]);
  useEffect(() => {
    if (!writable) return;
    const timer = window.setInterval(() => { if (!submitting && !confirming) void refresh(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [writable, submitting, confirming, refresh]);
  useEffect(() => { void refresh(); }, [workflowStatus, refresh]);

  const repositories = data?.repositories ?? [];
  const activeRepository = repositories.some(repo => repo.id === repositoryId) ? repositoryId : repositories[0]?.id ?? '';
  const selected = (data?.submissions ?? []).filter(row => selection[row.workflowRepositoryId]?.id === row.id && selection[row.workflowRepositoryId]?.headSha === row.headSha);
  const uncovered = repositories.filter(repo => !confirmRows?.some(row => row.workflowRepositoryId === repo.id));
  const canWrite = data?.canSubmit && writable;
  const busy = submitting || confirming;
  const repositoryName = (id: string) => repositories.find(repo => repo.id === id)?.name ?? id;

  async function submitBranch() {
    if (!canWrite || busy || !branch.trim() || !activeRepository) return;
    setSubmitting(true); setError(null); setMessage('');
    // 丢弃正在后台加载的旧清单，防止覆盖这次写入返回的版本。
    generation.current += 1;
    try {
      const result = await api.submitCodeBranch(workflowRunId, { workflowRepositoryId: activeRepository, branch: branch.trim() });
      if (!mounted.current) return;
      setData(result); setBranch(''); setLoading(false);
      setMessage('分支已记录。其他成员可继续提交，准备好后再确认本次交付。');
      await onChanged();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '分支提交失败');
    } finally { if (mounted.current) { setSubmitting(false); setLoading(false); } }
  }

  async function confirmDelivery() {
    if (!confirmRows?.length || busy || !canWrite) return;
    setConfirming(true); setConfirmError(null); generation.current += 1;
    try {
      const result = await api.confirmCodeDelivery(workflowRunId, { confirmed: true, submissions: confirmRows.map(({ id, headSha }) => ({ id, headSha })) });
      if (!mounted.current) return;
      setData(result); setConfirmRows(null); setLoading(false);
      setMessage('本次交付已冻结，请继续审查。');
      await onChanged();
    } catch (cause) {
      if (mounted.current) setConfirmError(cause instanceof Error ? cause.message : '确认交付失败');
    } finally { if (mounted.current) { setConfirming(false); setLoading(false); } }
  }

  return <Card id="workflow-code-delivery">
    <CardHeader className="gap-2 p-5 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">代码交付</h3><Button size="sm" variant="outline" disabled={loading || busy} onClick={() => void refresh()}>刷新代码交付</Button></div>
      <p className="text-sm text-muted-foreground">共用当前已确认的 PRD、设计和方案，各自在本地开发，推送后提交仓库分支。单次提交不会结束整个开发阶段。</p>
    </CardHeader>
    <CardContent className="space-y-4 p-5 pt-0">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
      {!data && loading ? <p role="status">正在读取代码交付…</p> : null}
      {data?.reason ? <p className="text-sm text-muted-foreground">{data.reason}</p> : null}
      {canWrite ? <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void submitBranch(); }}>
        <label className="flex min-w-40 flex-col gap-1 text-sm">仓库<select aria-label="仓库" className="h-10 rounded-md border border-input bg-background px-3" value={activeRepository} disabled={busy || !repositories.length} onChange={event => setRepositoryId(event.target.value)}>{repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label>
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm">已推送的分支<Input name="branch" value={branch} maxLength={240} placeholder="feature/notification" disabled={busy} onChange={event => setBranch(event.target.value)} required /></label>
        <Button type="submit" disabled={busy || !branch.trim() || !activeRepository}>{submitting ? '核验分支中…' : '提交分支'}</Button>
      </form> : null}
      {data?.confirmedDelivery ? <div className="space-y-2 rounded-md border border-border p-4 text-sm">
        <p className="font-medium">已确认本次交付 · {new Date(data.confirmedDelivery.confirmedAt).toLocaleString('zh-CN')}</p>
        {data.confirmedDelivery.submissions.map(row => <p key={row.id} className="break-all">{row.repository} · {row.branch} · <code>{row.headSha}</code></p>)}
        <p className="text-muted-foreground">后续审查和提测使用这些冻结版本；返工需进入新的开发尝试。</p>
      </div> : null}
      {repositories.map(repo => {
        const rows = data?.submissions.filter(row => row.workflowRepositoryId === repo.id) ?? [];
        return <section key={repo.id} className="space-y-2 rounded-md border border-border p-4">
          <h4 className="text-sm font-semibold">{repo.name} <span className="font-normal text-muted-foreground">· 基线 {repo.baseBranch}</span></h4>
          {!rows.length ? <p className="text-sm text-muted-foreground">尚未提交</p> : rows.map(row => <label key={row.id} className="flex items-start gap-3 rounded-md bg-muted/30 p-3 text-sm">
            {canWrite ? <input type="checkbox" className="mt-1" aria-label={`纳入本次交付 ${repo.name} ${row.branch} ${row.submittedBy?.displayName ?? '未知成员'}`} disabled={busy} checked={selected.some(item => item.id === row.id)} onChange={event => setSelection(previous => {
              const next = { ...previous };
              if (event.target.checked) next[repo.id] = { id: row.id, headSha: row.headSha }; else delete next[repo.id];
              return next;
            })} /> : null}
            <span className="min-w-0 space-y-1"><span className="block break-all font-medium">{row.branch}</span><code className="block break-all text-xs">{row.headSha}</code><span className="block text-xs text-muted-foreground">{row.submittedBy?.displayName ?? '未记录提交人'} · {new Date(row.updatedAt).toLocaleString('zh-CN')} · 分支已核验</span></span>
          </label>)}
        </section>;
      })}
      {canWrite ? <div className="space-y-3"><p className="text-sm text-muted-foreground">每个仓库选择一条最终交付分支。需要更新版本时，由提交人重新提交同一分支；平台不会合并分支，分支核验也不代表测试或联调通过。</p><Button disabled={!selected.length || busy} onClick={() => { setConfirmError(null); setConfirmRows(selected); }}>确认本次交付</Button></div> : null}
      {data?.history?.length ? <details className="rounded-md border border-border p-4 text-sm">
        <summary className="cursor-pointer font-medium">历史分支提交</summary>
        <p className="mt-3 text-muted-foreground">以下是之前开发尝试的记录，仅供追溯。本次交付需重新提交并确认。</p>
        {data.history.map(attempt => <section key={attempt.stageExecutionId} className="mt-3 space-y-2 border-t border-border pt-3">
          <h4 className="font-medium">第 {attempt.attempt} 次开发尝试</h4>
          {attempt.submissions.map(row => <p key={row.id} className="break-all">{repositoryName(row.workflowRepositoryId)} · {row.branch}<br /><code className="text-xs">{row.headSha}</code><br /><span className="text-xs text-muted-foreground">{row.submittedBy?.displayName ?? '未记录提交人'} · {new Date(row.updatedAt).toLocaleString('zh-CN')}</span></p>)}
        </section>)}
      </details> : null}
      <Dialog open={confirmRows !== null} onOpenChange={open => { if (!open && !confirming) setConfirmRows(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>确认本次代码交付</DialogTitle><DialogDescription>平台将重新核验所选版本、读取实际差异并进入审查。此操作不会合并或部署代码，也不代表测试通过。</DialogDescription></DialogHeader>
          <div className="max-h-[45vh] space-y-3 overflow-y-auto text-sm">{confirmRows?.map(row => <p key={row.id} className="break-all">{repositoryName(row.workflowRepositoryId)} · {row.branch}<br /><code>{row.headSha}</code></p>)}
            {uncovered.length ? <p className="rounded-md bg-warning/10 p-3 text-warning">未纳入本次交付的仓库：{uncovered.map(repo => repo.name).join('、')}。请确认这些仓库本次无需变更，或取消后补充分支。</p> : null}
          </div>
          {confirmError ? <p role="alert" className="text-sm text-destructive">{confirmError}</p> : null}
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={confirming} onClick={() => setConfirmRows(null)}>取消</Button><Button disabled={busy || !canWrite} onClick={() => void confirmDelivery()}>{confirming ? '读取差异并确认中…' : '确认并进入审查'}</Button></div>
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>;
}
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CodeBranchSubmission, WorkflowCodeDelivery } from '../types';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader } from './ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
