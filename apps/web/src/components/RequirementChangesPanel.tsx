import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { RequirementChange, RequirementChanges } from '../types';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
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
  const [file, setFile] = useState<File | null>(null);
  const [aiProvider, setAiProvider] = useState<'inherit' | 'codex' | 'cursor' | null>(null);
  const pendingNavigate = useRef<string | null>(null);
  const invalidFile = file && (!/\.zip$/i.test(file.name) || file.size > 20 * 1024 * 1024);

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

  useEffect(() => {
    const completed = data?.changes.find(record => record.id === pendingNavigate.current && record.restartStatus === 'STARTED' && record.restartWorkflowRunId);
    if (completed) { pendingNavigate.current = null; navigate(`/workflow-runs/${completed.restartWorkflowRunId}`); }
  }, [data, navigate]);

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
    pendingNavigate.current = record.restartStatus === 'STARTING' ? record.id : null;
    if (record.restartStatus === 'STARTED' && record.restartWorkflowRunId) {
      navigate(`/workflow-runs/${record.restartWorkflowRunId}`);
    }
  };

  const submit = async (mode: RequirementChange['mode']) => {
    const text = content.trim() || (file ? `更新原型：${file.name}` : '');
    if (!text || writing.current || invalidFile || (file && mode !== 'RESTART')) return;
    const currentGeneration = generation.current;
    writing.current = true;
    setBusy(true);
    setWriteError(null);
    try {
      const provider = aiProvider ?? data?.aiProvider ?? 'inherit';
      const signature = JSON.stringify([text, mode, provider, file?.name, file?.size, file?.lastModified]);
      if (draftRequest.current?.signature !== signature) {
        const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID() : `change-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        draftRequest.current = { signature, id };
      }
      const payload = {
        content: text, mode, requestId: draftRequest.current.id,
        ...(workflowRunId ? { sourceWorkflowRunId: workflowRunId } : {}),
      };
      const record = file ? await api.createPrototypeRequirementChange(requirementId, { ...payload, ...(provider === 'inherit' ? {} : { aiProvider: provider }) }, file) : await api.createRequirementChange(requirementId, payload);
      if (generation.current !== currentGeneration) return;
      apply(record);
      setContent(''); setFile(null); setAiProvider(null);
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

  const download = async (record: RequirementChange) => {
    try {
      const blob = await api.downloadRequirementChangePrototype(requirementId, record.id);
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = record.prototype?.name ?? 'prototype.zip'; document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    } catch (error) { setWriteError(error instanceof Error ? error.message : '原型下载失败'); }
  };

  const renderRecord = (record: RequirementChange) => (
    <article key={record.id} className="space-y-2 border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>第 {record.revision} 次变更</span>
        <span>{record.createdByName}</span>
        <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false })}</time>
        <span>{record.mode === 'SUPPLEMENT' ? '补充变更' : ({ NOT_REQUESTED: '重新走流程', PENDING: '待启动', STARTING: record.prototype ? '正在整理原型并启动流程' : '正在启动流程', STARTED: '已启动新流程', FAILED: '启动失败' })[record.restartStatus]}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{record.content}</p>
      {record.prototype && <Button size="sm" variant="ghost" onClick={() => void download(record)}>下载 {record.prototype.name}</Button>}
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
          <label className="block space-y-2 text-sm"><span>变更说明</span><Textarea autoFocus value={content} onChange={event => setContent(event.target.value)} placeholder="一句话说明要改什么，例如：导出增加 Excel 格式" required={!file} maxLength={10000} disabled={busy} rows={3} /></label>
          <label className="block space-y-2 text-sm"><span>更新原型 ZIP（可选，最大 20 MiB）</span><Input key={file ? 'selected' : 'empty'} type="file" accept=".zip,application/zip" aria-label="变更原型 ZIP" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); draftRequest.current = null; }} /></label>
          {file && <>
            <div className="flex flex-wrap items-center gap-2 text-sm"><span>{file.name}</span><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setFile(null); draftRequest.current = null; }}>移除 ZIP</Button></div>
            <div className="max-w-xs space-y-2"><label className="text-sm" htmlFor={`change-ai-${requirementId}`}>使用的 AI</label><Select value={aiProvider ?? data?.aiProvider ?? 'inherit'} onValueChange={(value: 'inherit' | 'codex' | 'cursor') => setAiProvider(value)} disabled={busy}>
              <SelectTrigger id={`change-ai-${requirementId}`} aria-label="变更使用的 AI"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">沿用当前 AI</SelectItem><SelectItem value="codex">Codex</SelectItem><SelectItem value="cursor">Cursor CLI</SelectItem></SelectContent>
            </Select></div>
            <p className="text-xs text-muted-foreground">以新 ZIP 重新整理需求与设计并启动新一轮流程，旧流程和材料保留。变更说明可留空。</p>
          </>}
          {invalidFile && <p role="alert" className="text-sm text-destructive">请选择不超过 20 MiB 的 ZIP 文件</p>}
          <p className="text-xs leading-5 text-muted-foreground">提交后继续当前流程；较大调整可重新走澄清、设计和研发流程，旧流程与产物保留。</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" disabled={busy || !!file || !content.trim()}>{busy ? '正在提交…' : '提交变更'}</Button>
            <Button size="sm" type="button" variant="outline" disabled={busy || !!invalidFile || (!content.trim() && !file)} onClick={() => void submit('RESTART')}>重新走流程</Button>
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
