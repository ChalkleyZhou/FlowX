import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { RequirementChange, RequirementChanges } from '../types';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Textarea } from './ui/textarea';

interface Props {
  requirementId: string;
  workflowRunId?: string;
  refreshKey?: string;
  onChanged?: () => void | Promise<void>;
}

export function RequirementChangesPanel(props: Props) {
  return <ChangesPanel key={`${props.requirementId}:${props.workflowRunId ?? ''}`} {...props} />;
}

function ChangesPanel({ requirementId, workflowRunId, refreshKey, onChanged }: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<RequirementChanges | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const readVersion = useRef(0);
  const reading = useRef(false);
  const reloadPending = useRef(false);
  const writing = useRef(false);
  const draftRequest = useRef<{ signature: string; id: string } | null>(null);

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}): Promise<void> => {
    if (reading.current) return;
    reading.current = true;
    const currentGeneration = generation.current;
    const version = ++readVersion.current;
    if (!silent) setLoading(true);
    try {
      const next = await api.getRequirementChanges(requirementId, workflowRunId);
      if (generation.current !== currentGeneration || version !== readVersion.current) return;
      setData(previous => previous && previous.revision > next.revision ? previous : next);
      setLoadError(null);
    } catch (error) {
      if (generation.current === currentGeneration && version === readVersion.current) {
        setLoadError(error instanceof Error ? error.message : '变更记录加载失败');
      }
    } finally {
      if (generation.current === currentGeneration) {
        reading.current = false;
        setLoading(false);
        if (reloadPending.current) {
          reloadPending.current = false;
          void load({ silent: true });
        }
      }
    }
  }, [requirementId, workflowRunId]);

  useEffect(() => {
    generation.current += 1;
    reading.current = false;
    reloadPending.current = false;
    void load();
    const onFocus = () => { void load({ silent: true }); };
    window.addEventListener('focus', onFocus);
    return () => {
      generation.current += 1;
      reading.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  useEffect(() => { if (refreshKey) void load({ silent: true }); }, [refreshKey, load]);

  const starting = data?.changes.some(change => change.restartStatus === 'STARTING') ?? false;
  useEffect(() => {
    if (!starting) return;
    const timer = window.setInterval(() => { void load({ silent: true }); }, 2500);
    return () => window.clearInterval(timer);
  }, [starting, load]);

  const apply = (record: RequirementChange) => {
    // 丢弃先前的列表请求，避免成功提交后被旧快照覆盖。
    readVersion.current += 1;
    setData(previous => ({
      ...previous,
      revision: Math.max(previous?.revision ?? 0, record.revision),
      changes: [record, ...(previous?.changes ?? []).filter(item => item.id !== record.id)].sort((a, b) => b.revision - a.revision),
      ...(workflowRunId ? { hasPendingChanges: record.revision > (previous?.contextRevision ?? 0) } : {}),
    }));
    if (reading.current) reloadPending.current = true;
    else void load({ silent: true });
    void Promise.resolve(onChanged?.()).catch(() => undefined);
    if (record.restartStatus === 'STARTED' && record.restartWorkflowRunId) {
      navigate(`/workflow-runs/${record.restartWorkflowRunId}`);
    }
  };

  const submit = async (mode: RequirementChange['mode']) => {
    const text = content.trim();
    if (!text || writing.current) return;
    const currentGeneration = generation.current;
    writing.current = true;
    setBusy(true);
    setWriteError(null);
    try {
      const signature = JSON.stringify([text, mode]);
      if (draftRequest.current?.signature !== signature) {
        const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID() : `change-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        draftRequest.current = { signature, id };
      }
      const record = await api.createRequirementChange(requirementId, {
        content: text, mode, requestId: draftRequest.current.id,
        ...(workflowRunId ? { sourceWorkflowRunId: workflowRunId } : {}),
      });
      if (generation.current !== currentGeneration) return;
      apply(record);
      setContent('');
      setOpen(false);
      draftRequest.current = null;
    } catch (error) {
      if (generation.current === currentGeneration) setWriteError(error instanceof Error ? error.message : '变更提交失败，请重试');
    } finally {
      if (generation.current === currentGeneration) { writing.current = false; setBusy(false); }
    }
  };

  const restart = async (record: RequirementChange) => {
    if (writing.current) return;
    const currentGeneration = generation.current;
    writing.current = true;
    setBusy(true);
    setWriteError(null);
    try {
      const next = await api.restartRequirementChange(requirementId, record.id);
      if (generation.current === currentGeneration) apply(next);
    } catch (error) {
      if (generation.current === currentGeneration) setWriteError(error instanceof Error ? error.message : '流程启动失败，变更已保留');
    } finally {
      if (generation.current === currentGeneration) { writing.current = false; setBusy(false); }
    }
  };

  const renderRecord = (record: RequirementChange) => (
    <article key={record.id} className="space-y-2 border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>第 {record.revision} 次变更</span>
        <span>{record.createdByName}</span>
        <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false })}</time>
        <span>{record.mode === 'SUPPLEMENT' ? '补充变更' : ({ NOT_REQUESTED: '重新走流程', PENDING: '待启动', STARTING: '正在启动流程', STARTED: '已启动新流程', FAILED: '启动失败' })[record.restartStatus]}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{record.content}</p>
      {record.errorMessage && <p className="text-sm text-muted-foreground">{record.errorMessage}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {record.mode === 'RESTART' && ['PENDING', 'FAILED'].includes(record.restartStatus) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void restart(record)}>继续启动流程</Button>
        )}
        {record.restartStatus === 'STARTED' && record.restartWorkflowRunId && (
          <Link className="text-sm text-primary hover:underline" to={`/workflow-runs/${record.restartWorkflowRunId}`}>进入新流程</Link>
        )}
        {record.sourceWorkflowRunId && (
          <Link className="text-sm text-muted-foreground hover:underline" to={`/workflow-runs/${record.sourceWorkflowRunId}`}>查看原流程</Link>
        )}
      </div>
    </article>
  );

  const records = [...(data?.changes ?? [])].sort((a, b) => b.revision - a.revision);
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">需求变更记录{records.length ? ` · ${records.length}` : ''}</h2>
          <div className="flex gap-2">
            {records.length > 0 && <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load({ silent: true })}>刷新变更</Button>}
            <Button size="sm" variant="outline" onClick={() => setOpen(value => !value)} disabled={busy} aria-expanded={open}>需求变更</Button>
          </div>
        </div>
        {data?.hasPendingChanges && <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">当前任务尚未读取最新变更。后续生成或重新领取将带上变更；正在运行的本地任务需先结束再重新领取。</p>}
        {open && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit('SUPPLEMENT'); }}>
          <label className="block space-y-2 text-sm"><span>变更说明</span><Textarea autoFocus value={content} onChange={event => setContent(event.target.value)} placeholder="一句话说明要改什么，例如：导出增加 Excel 格式" required maxLength={10000} disabled={busy} rows={3} /></label>
          <p className="text-xs leading-5 text-muted-foreground">提交后继续当前流程；较大调整可重新走澄清、设计和研发流程，旧流程与产物保留。</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={busy || !content.trim()}>{busy ? '正在提交…' : '提交变更'}</Button>
            <Button size="sm" type="button" variant="outline" disabled={busy || !content.trim()} onClick={() => void submit('RESTART')}>重新走流程</Button>
            <Button size="sm" type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>收起</Button>
          </div>
        </form>}
        {writeError && <p role="alert" className="text-sm text-destructive">{writeError}</p>}
        {loadError && <div className="flex items-center gap-3"><p role="alert" className="text-sm text-destructive">{loadError}</p><Button size="sm" variant="outline" onClick={() => void load({ silent: !!data })}>重新加载</Button></div>}
        {loading && !data ? <p role="status" className="text-sm text-muted-foreground">正在加载变更…</p> : records.length === 0 && !loadError ? <p className="text-sm text-muted-foreground">有调整时，一句话记录即可。</p> : null}
        {records.slice(0, 3).map(renderRecord)}
        {records.length > 3 && <details><summary className="cursor-pointer text-sm text-muted-foreground">更早的变更（{records.length - 3}）</summary>{records.slice(3).map(renderRecord)}</details>}
      </CardContent>
    </Card>
  );
}
