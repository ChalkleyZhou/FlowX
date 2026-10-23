import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { PrototypeImport } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface Props {
  importId: string;
  onConfirmed: () => void | Promise<void>;
  existingWorkflowId?: string;
}
const MAX_ZIP_BYTES = 20 * 1024 * 1024;

export function PrototypeImportPanel({ importId, onConfirmed }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const autoEnter = useRef(false);
  const [record, setRecord] = useState<PrototypeImport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    setRecord(null); setError(null); setBusy(false); setExpanded(false); setFile(null); setSelectedPath(''); setPreview(null);
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
      if (version === epoch.current) { apply(next); setFile(null); }
    } catch (err) {
      if (version === epoch.current) setError(err instanceof Error ? err.message : '导入失败，请重试');
    } finally {
      if (version === epoch.current) { operation.current = false; setBusy(false); }
    }
  }, [apply]);

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
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-5" aria-label="原型快速导入">
      <h2 className="text-lg font-semibold" role="status">{failed ? '导入失败' : succeeded ? '导入成功' : '正在导入'}</h2>
      <p className="text-sm text-muted-foreground">{failed ? '原材料已保留，处理后可直接重试。' : succeeded ? '已接入研发流程。' : 'AI 正在整理需求与设计，完成后自动进入研发流程，无需确认。可离开页面，稍后回来查看。'}</p>
      {(error || record.errorMessage) && <p role="alert" className="text-sm text-danger">{error ?? record.errorMessage}</p>}
      {failed && <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => void run(() => api.analyzePrototypeImport(importId, { revision: record.revision }))}>{busy ? '重试中…' : '重试导入'}</Button>
          <Button variant="outline" disabled={busy || loading} onClick={() => void refresh()}>刷新状态</Button>
        </div>
        <label className="flex flex-col gap-2 text-sm">更换或补充 ZIP（可选，最大 20 MiB）
          <Input type="file" accept=".zip,application/zip" aria-label="补传原型 ZIP" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        {invalidFile && <p role="alert" className="text-sm text-danger">请选择不超过 20 MiB 的 ZIP 文件</p>}
        {file && <Button variant="outline" disabled={busy || !!invalidFile} onClick={() => void run(() => api.supplementPrototypeImport(importId, record.revision, file))}>上传并重试</Button>}
      </div>}
      {processing && error && <Button variant="outline" disabled={busy || loading} onClick={() => { resumed.current = false; void refresh(); }}>重试接续</Button>}
      {succeeded && <Button asChild><Link to={`/workflow-runs/${workflowId}`}>进入工作流</Link></Button>}
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
