import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { PrototypeImport } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface Props {
  importId: string;
  onConfirmed: () => void | Promise<void>;
  existingWorkflowId?: string;
}
const MAX_ZIP_BYTES = 20 * 1024 * 1024;

export function PrototypeImportPanel({ importId, onConfirmed, existingWorkflowId }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const autoEnter = useRef(false);
  const [record, setRecord] = useState<PrototypeImport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryProvider, setRetryProvider] = useState<PrototypeImport['aiProvider'] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [preview, setPreview] = useState<{ html: string; warnings: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const iframe = useRef<HTMLIFrameElement>(null);
  const epoch = useRef(0);
  const request = useRef<object | null>(null);
  const operation = useRef(false);
  const completed = useRef<string | null>(null);
  const resumed = useRef(false);
  const reanalyzeRequest = useRef<{ signature: string; id: string } | null>(null);
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);

  const apply = useCallback((next: PrototypeImport) => {
    if (next.status === 'ANALYZING' || next.status === 'WAITING_CONFIRMATION' || (next.status === 'CONFIRMED' && !next.workflowRunId)) autoEnter.current = true;
    setRecord(next);
    setSelectedPath((current) => next.manifest.pages.some((page) => page.path === current) ? current : next.manifest.pages[0]?.path ?? '');
  }, []);
  const refresh = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (request.current || operation.current) return;
    const token = {};
    const version = epoch.current;
    request.current = token;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const next = await api.getPrototypeImport(importId);
      if (version === epoch.current && request.current === token) apply(next);
    } catch (err) {
      if (version === epoch.current && !silent) setError(err instanceof Error ? err.message : '加载导入状态失败');
    } finally {
      if (request.current === token) request.current = null;
      if (version === epoch.current) setLoading(false);
    }
  }, [importId, apply]);

  useEffect(() => {
    epoch.current += 1;
    autoEnter.current = new URLSearchParams(location.search).get('importing') === '1';
    request.current = null; operation.current = false; completed.current = null; resumed.current = false;
    setRecord(null); setError(null); setBusy(false); setRetryProvider(null); setExpanded(false); setReanalyzeOpen(false); setFile(null); setSelectedPath(''); setPreview(null); reanalyzeRequest.current = null;
    void refresh();
    return () => { epoch.current += 1; request.current = null; };
  }, [refresh, location.search]);

  const workflowId = record?.workflowRunId;
  const succeeded = record?.status === 'CONFIRMED' && !!workflowId;
  const processing = record?.status === 'ANALYZING' || record?.status === 'WAITING_CONFIRMATION' || (record?.status === 'CONFIRMED' && !workflowId);
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => void refresh({ silent: true }), 3000);
    return () => window.clearInterval(timer);
  }, [processing, refresh]);

  useEffect(() => {
    if (!autoEnter.current || !succeeded || !workflowId || completed.current === workflowId) return;
    completed.current = workflowId;
    void Promise.resolve(onConfirmed()).catch(() => undefined);
    navigate(`/workflow-runs/${workflowId}`, { replace: true });
  }, [succeeded, workflowId, onConfirmed, navigate]);

  const run = useCallback(async (action: () => Promise<PrototypeImport>) => {
    if (operation.current) return;
    operation.current = true;
    // 操作开始前的 GET 不能回退新状态；旧请求完成时也不能释放新请求的锁。
    request.current = null;
    const version = epoch.current;
    setBusy(true); setError(null);
    try {
      const next = await action();
      if (version === epoch.current) { apply(next); setFile(null); setReanalyzeOpen(false); reanalyzeRequest.current = null; }
    } catch (err) {
      if (version === epoch.current) {
        setError(err instanceof Error ? err.message : '导入失败，请重试');
        // 换包失败也可能已推进修订；保留选择并同步服务端版本，允许直接再试。
        try { const latest = await api.getPrototypeImport(importId); if (version === epoch.current) apply(latest); } catch { /* 保留原始提交错误 */ }
      }
    } finally {
      if (version === epoch.current) { operation.current = false; setBusy(false); }
    }
  }, [apply, importId]);

  useEffect(() => {
    if (record?.status !== 'WAITING_CONFIRMATION' || resumed.current) return;
    resumed.current = true;
    void run(() => api.analyzePrototypeImport(importId, { revision: record.revision }));
  }, [record, importId, run]);

  useEffect(() => {
    if (!expanded || !selectedPath) return;
    let cancelled = false;
    setPreview(null); setPreviewError(null);
    void api.previewPrototypeImport(importId, selectedPath).then((result) => {
      if (!cancelled) setPreview(result);
    }).catch((err: unknown) => {
      if (!cancelled) setPreviewError(err instanceof Error ? err.message : '加载原型预览失败');
    });
    return () => { cancelled = true; };
  }, [importId, expanded, selectedPath, record?.materialRevision, previewKey]);

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== iframe.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      const message = event.data as { type?: unknown; path?: unknown };
      if (message.type === 'flowx-prototype-navigate' && typeof message.path === 'string' && record?.manifest.pages.some((page) => page.path === message.path)) setSelectedPath(message.path);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [record?.manifest.pages]);

  async function download(name: string, revision: number) {
    try {
      const blob = await api.downloadPrototypeImport(importId, revision);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    } catch (err) { setError(err instanceof Error ? err.message : '下载失败'); }
  }

  if (loading && !record) return <p role="status">正在加载导入状态…</p>;
  if (!record) return <div role="alert">{error ?? '原型未找到'}<Button onClick={() => void refresh()}>重试</Button></div>;
  const failed = record.status === 'FAILED';
  const invalidFile = file && (!/\.zip$/i.test(file.name) || file.size > MAX_ZIP_BYTES);
  const currentPackage = record.manifest.sources.at(-1);
  async function submitReanalyze() {
    if (!file || invalidFile) return;
    const provider = retryProvider ?? record!.aiProvider;
    const signature = JSON.stringify([file.name, file.size, file.lastModified, provider]);
    if (reanalyzeRequest.current?.signature !== signature) {
      const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `reanalyze-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      reanalyzeRequest.current = { signature, id };
    }
    const sourceWorkflowRunId = existingWorkflowId ?? record!.workflowRunId ?? undefined;
    const requestId = reanalyzeRequest.current.id;
    await run(async () => {
      await api.createPrototypeRequirementChange(record!.requirementId, {
        content: `更新原型：${file.name}`,
        mode: 'RESTART',
        requestId,
        ...(sourceWorkflowRunId ? { sourceWorkflowRunId } : {}),
        aiProvider: provider,
      }, file);
      await Promise.resolve(onConfirmed());
      return record!;
    });
  }
  if (succeeded) {
    return (
      <div className="flex flex-col gap-3" aria-label="原型材料">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" aria-expanded={reanalyzeOpen} disabled={busy} onClick={() => setReanalyzeOpen((current) => !current)}>{reanalyzeOpen ? '收起' : '重新分析'}</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy || !currentPackage} onClick={() => { if (currentPackage) void download(currentPackage.name, currentPackage.revision); }}>下载包</Button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {reanalyzeOpen && <div className="flex max-w-md flex-col gap-3">
          <div className="flex max-w-xs flex-col gap-2">
            <label className="text-sm" htmlFor={`prototype-reanalyze-provider-${importId}`}>使用的 AI</label>
            <Select value={retryProvider ?? record.aiProvider} onValueChange={(value: PrototypeImport['aiProvider']) => setRetryProvider(value)} disabled={busy}>
              <SelectTrigger id={`prototype-reanalyze-provider-${importId}`} aria-label="重新分析使用的 AI"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="codex">Codex</SelectItem><SelectItem value="cursor">Cursor CLI</SelectItem></SelectContent>
            </Select>
          </div>
          <label className="flex flex-col gap-2 text-sm">新的原型 ZIP（最大 20 MiB）
            <Input key={file ? 'selected' : 'empty'} type="file" accept=".zip,application/zip" aria-label="重新分析原型 ZIP" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          {file ? <div className="flex flex-wrap items-center gap-2 text-sm"><span>{file.name}</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => setFile(null)}>移除 ZIP</Button></div> : null}
          <p className="text-xs text-muted-foreground">上传新包后重新整理，并启动新一轮流程。旧流程和当前包保留。</p>
          {invalidFile && <p role="alert" className="text-sm text-danger">请选择不超过 20 MiB 的 ZIP 文件</p>}
          <Button size="sm" disabled={busy || !file || !!invalidFile} onClick={() => void submitReanalyze()}>{busy ? '正在提交…' : '重新分析'}</Button>
        </div>}
      </div>
    );
  }
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-5" aria-label="原型快速导入">
      <h2 className="text-lg font-semibold" role="status">{failed ? '导入失败' : '正在导入'}</h2>
      <p className="text-sm text-muted-foreground">{failed ? '原材料已保留，处理后可直接重试。' : 'AI 正在整理需求与设计，完成后自动进入研发流程，无需确认。可离开页面，稍后回来查看。'}</p>
      {(error || record.errorMessage) && <p role="alert" className="text-sm text-danger">{error ?? record.errorMessage}</p>}
      {failed && <div className="flex flex-col gap-3">
        <div className="flex max-w-xs flex-col gap-2">
          <label className="text-sm" htmlFor={`prototype-retry-provider-${importId}`}>使用的 AI</label>
          <Select value={retryProvider ?? record.aiProvider} onValueChange={(value: PrototypeImport['aiProvider']) => setRetryProvider(value)} disabled={busy}>
            <SelectTrigger id={`prototype-retry-provider-${importId}`} aria-label="使用的 AI"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="codex">Codex</SelectItem><SelectItem value="cursor">Cursor CLI</SelectItem></SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">当前 ZIP：{record.manifest.sources.at(-1)?.name ?? '已保存的原型包'}</p>
        <label className="flex flex-col gap-2 text-sm">更换 ZIP（可选，最大 20 MiB）
          <Input key={file ? 'selected' : 'empty'} type="file" accept=".zip,application/zip" aria-label="更换原型 ZIP" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        {file ? <div className="flex flex-wrap items-center gap-2 text-sm"><span>将使用：{file.name}</span><Button variant="ghost" size="sm" disabled={busy} onClick={() => setFile(null)}>移除新 ZIP</Button></div> : null}
        <p className="text-xs text-muted-foreground">不换包则沿用当前材料；更换后以新 ZIP 完整重新分析，旧包保留在历史中。</p>
        {invalidFile && <p role="alert" className="text-sm text-danger">请选择不超过 20 MiB 的 ZIP 文件</p>}
        <div className="flex gap-2">
          <Button disabled={busy || !!invalidFile} onClick={() => void run(() => file
            ? api.supplementPrototypeImport(importId, record.revision, file, retryProvider ?? record.aiProvider, true)
            : api.analyzePrototypeImport(importId, { revision: record.revision, aiProvider: retryProvider ?? record.aiProvider }))}>{busy ? '正在提交…' : '重新导入'}</Button>
          <Button variant="outline" disabled={busy || loading} onClick={() => void refresh()}>刷新状态</Button>
        </div>
      </div>}
      {processing && error && <Button variant="outline" disabled={busy || loading} onClick={() => { resumed.current = false; void refresh(); }}>重试接续</Button>}
      <div><Button variant="ghost" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? '收起原型与材料' : '查看原型与材料'}</Button></div>
      {expanded && <div className="flex flex-col gap-3">
        {record.manifest.warnings.length > 0 && <ul className="list-disc pl-5 text-sm text-muted-foreground">{record.manifest.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        <div className="flex flex-wrap gap-2">{record.manifest.pages.map((page) => <Button key={page.path} size="sm" variant={selectedPath === page.path ? 'default' : 'outline'} aria-pressed={selectedPath === page.path} onClick={() => setSelectedPath(page.path)}>{page.title || page.path}</Button>)}</div>
        {previewError ? <p role="alert">{previewError}<Button variant="outline" onClick={() => setPreviewKey((key) => key + 1)}>重试预览</Button></p> : preview ? <iframe ref={iframe} title="导入原型预览" sandbox="allow-scripts" srcDoc={preview.html} className="h-[560px] w-full rounded-md border border-border" /> : <p className="text-sm text-muted-foreground">{selectedPath ? '加载原型预览…' : '无可预览页面，可下载原包查看。'}</p>}
        <div className="flex flex-wrap gap-2">{record.manifest.sources.map((source) => <Button key={source.revision} variant="outline" size="sm" onClick={() => void download(source.name, source.revision)}>下载 {source.name}（第 {source.revision} 版）</Button>)}</div>
      </div>}
    </section>
  );
}
