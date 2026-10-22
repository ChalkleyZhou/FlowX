import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { PrototypeAnalysis, PrototypeImport, PrototypeImportUpdate } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

interface Props {
  importId: string;
  onConfirmed: () => void | Promise<void>;
  existingWorkflowId?: string;
}
const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const statusLabels = {
  ANALYZING: 'AI 整理中',
  WAITING_CONFIRMATION: '等待确认',
  FAILED: '整理失败',
  CONFIRMED: '已确认',
};

export function PrototypeImportPanel({ importId, onConfirmed, existingWorkflowId }: Props) {
  const navigate = useNavigate();
  const [record, setRecord] = useState<PrototypeImport | null>(null);
  const [analysis, setAnalysis] = useState<PrototypeAnalysis | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedPath, setSelectedPath] = useState('');
  const [preview, setPreview] = useState<{ html: string; warnings: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState('');
  const [hasConflict, setHasConflict] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const epoch = useRef(0);
  const request = useRef<object | null>(null);
  const operation = useRef(false);
  const refreshRevision = useRef(0);
  const dirty = useRef(false);
  const draftRevision = useRef<number | null>(null);

  const apply = useCallback((next: PrototypeImport, replaceDraft: boolean) => {
    setRecord(next);
    if (replaceDraft || !dirty.current) {
      setAnalysis(next.analysis);
      setAnswers(next.answers);
      dirty.current = false;
      draftRevision.current = next.revision;
      setHasConflict(false);
    } else if (next.revision !== draftRevision.current) {
      // 草稿必须继续使用读取时的修订，不能借刷新获得的新修订覆盖他人修改。
      setHasConflict(true);
    }
    setSelectedPath((current) =>
      next.manifest.pages.some((page) => page.path === current)
        ? current
        : (next.manifest.pages[0]?.path ?? ''),
    );
  }, []);

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (request.current || operation.current) return;
      const token = {};
      const version = epoch.current;
      const revision = refreshRevision.current;
      request.current = token;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const next = await api.getPrototypeImport(importId);
        if (version === epoch.current && revision === refreshRevision.current && request.current === token)
          apply(next, false);
      } catch (err) {
        if (
          version === epoch.current &&
          revision === refreshRevision.current &&
          request.current === token &&
          !silent
        )
          setError(err instanceof Error ? err.message : '加载原型失败');
      } finally {
        if (request.current === token) request.current = null;
        if (version === epoch.current) setLoading(false);
      }
    },
    [importId, apply],
  );

  useEffect(() => {
    epoch.current += 1;
    request.current = null;
    operation.current = false;
    dirty.current = false;
    draftRevision.current = null;
    setHasConflict(false);
    setRecord(null);
    setAnalysis(null);
    setAnswers({});
    setPreview(null);
    setPreviewError(null);
    setSelectedPath('');
    setFeedback('');
    setFile(null);
    setBusy(false);
    setNotice('');
    void refresh();
    return () => {
      epoch.current += 1;
      request.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (record?.status !== 'ANALYZING') return;
    const timer = window.setInterval(() => void refresh({ silent: true }), 3000);
    return () => window.clearInterval(timer);
  }, [record?.status, refresh]);

  useEffect(() => {
    if (!selectedPath) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewError(null);
    setPreview(null);
    void api
      .previewPrototypeImport(importId, selectedPath)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setPreviewError(err instanceof Error ? err.message : '加载原型预览失败');
      });
    return () => {
      cancelled = true;
    };
  }, [importId, selectedPath, record?.materialRevision, previewKey]);

  useEffect(() => {
    const navigatePage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframe.current?.contentWindow || !event.data || typeof event.data !== 'object')
        return;
      const message = event.data as { type?: unknown; path?: unknown };
      if (
        message.type === 'flowx-prototype-navigate' &&
        typeof message.path === 'string' &&
        record?.manifest.pages.some((page) => page.path === message.path)
      )
        setSelectedPath(message.path);
    };
    window.addEventListener('message', navigatePage);
    return () => window.removeEventListener('message', navigatePage);
  }, [record?.manifest.pages]);

  const updateAnalysis = (next: PrototypeAnalysis) => {
    dirty.current = true;
    setAnalysis(next);
    setNotice('');
  };
  const updateAnswer = (id: string, value: string) => {
    dirty.current = true;
    setAnswers((current) => ({ ...current, [id]: value }));
    setNotice('');
  };
  const payload = (): PrototypeImportUpdate => ({
    revision: draftRevision.current ?? record!.revision,
    ...(analysis
      ? {
          analysis: {
            ...analysis,
            acceptanceCriteria: analysis.acceptanceCriteria.map((item) => item.trim()).filter(Boolean),
          },
        }
      : {}),
    answers,
  });

  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    // 保留在途刷新锁；操作开始前发出的旧 GET 不得覆盖操作结果。
    refreshRevision.current += 1;
    const version = epoch.current;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await action();
    } catch (err) {
      if (version === epoch.current) {
        setError(err instanceof Error ? err.message : '操作失败，请重试');
        if (err instanceof Error && 'status' in err && err.status === 409) setHasConflict(true);
      }
    } finally {
      if (version === epoch.current) {
        operation.current = false;
        setBusy(false);
      }
    }
  }
  async function loadLatestDraft() {
    const version = epoch.current;
    const next = await api.getPrototypeImport(importId);
    if (version !== epoch.current) return;
    apply(next, true);
    setFeedback('');
    setNotice('已放弃本地编辑并载入最新版本');
  }
  async function continueWorkflow(confirmed: PrototypeImport) {
    const version = epoch.current;
    if (existingWorkflowId) {
      navigate(`/workflow-runs/${existingWorkflowId}`);
      return;
    }
    const workflow = await api.createWorkflowRun(confirmed.requirementId, undefined, confirmed.aiProvider);
    if (version === epoch.current) navigate(`/workflow-runs/${workflow.id}`);
  }
  async function confirm() {
    if (!record) return;
    const version = epoch.current;
    const confirmed = await api.confirmPrototypeImport(importId, payload());
    if (version !== epoch.current) return;
    apply(confirmed, true);
    await onConfirmed();
    if (version === epoch.current) await continueWorkflow(confirmed);
  }
  async function mutate(action: () => Promise<PrototypeImport>, message: string, resetFeedback = false) {
    const version = epoch.current;
    const next = await action();
    if (version !== epoch.current) return;
    apply(next, true);
    if (resetFeedback) setFeedback('');
    setNotice(message);
  }
  async function download(name: string, revision: number) {
    const blob = await api.downloadPrototypeImport(importId, revision);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  if (loading && !record) return <p role="status">正在加载原型…</p>;
  if (!record)
    return (
      <div role="alert">
        {error ?? '原型未找到'}
        <Button onClick={() => void refresh()}>重试</Button>
      </div>
    );
  const confirmed = record.status === 'CONFIRMED';
  const editable = !confirmed && !busy && record.status !== 'ANALYZING';
  const missingAnswers =
    analysis?.clarifications.some((question) => question.required && !answers[question.id]?.trim()) ?? true;
  const warnings = [...new Set([...record.manifest.warnings, ...(preview?.warnings ?? [])])];

  return (
    <section
      className="flex flex-col gap-4 rounded-md border border-border bg-card p-5"
      aria-label="原型导入确认"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">原型与需求确认</h2>
        <span role="status">{statusLabels[record.status]}</span>
        <Button variant="outline" disabled={busy || loading} onClick={() => void refresh()}>
          刷新原型状态
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        核对原型、需求草稿和关键问题，确认后进入 Spec &amp; Plan。
      </p>
      {record.status === 'ANALYZING' && (
        <p role="status" className="text-sm text-muted-foreground">
          AI 正在整理原型，可先查看材料，完成后自动更新。
        </p>
      )}
      {(error || record.errorMessage) && (
        <p role="alert" className="text-sm text-danger">
          {error ?? record.errorMessage}
        </p>
      )}
      {hasConflict && (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
          <p>服务端已有新版本。当前展示的本地编辑已保留，提交仍使用原修订进行冲突检查。</p>
          <p className="text-muted-foreground">可继续保留本地编辑；如需合并，请先复制要保留的内容，再载入最新版本。</p>
          <Button variant="outline" disabled={busy || loading} onClick={() => void run(loadLatestDraft)}>
            放弃本地编辑，载入最新版本
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {warnings.length > 0 && (
        <ul aria-label="原型提示" className="list-disc pl-5 text-sm text-muted-foreground">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {record.manifest.pages.map((page) => (
          <Button
            key={page.path}
            size="sm"
            variant={selectedPath === page.path ? 'default' : 'outline'}
            onClick={() => setSelectedPath(page.path)}
            aria-pressed={selectedPath === page.path}
          >
            {page.title || page.path}
          </Button>
        ))}
      </div>
      {previewError ? (
        <div role="alert">
          {previewError}
          <Button variant="outline" onClick={() => setPreviewKey((key) => key + 1)}>
            重试预览
          </Button>
        </div>
      ) : preview ? (
        <iframe
          ref={iframe}
          title="导入原型预览"
          sandbox="allow-scripts"
          srcDoc={preview.html}
          className="h-[560px] w-full rounded-md border border-border bg-card"
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {selectedPath ? '加载原型预览…' : '材料未包含可预览页面，可下载来源文件核对。'}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>来源材料</span>
        {record.manifest.sources.map((source) => (
          <Button
            key={source.revision}
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => download(source.name, source.revision))}
          >
            下载 {source.name}（第 {source.revision} 版）
          </Button>
        ))}
      </div>
      {analysis && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm">
            需求标题
            <Input
              aria-label="需求标题"
              value={analysis.title}
              disabled={!editable}
              onChange={(event) => updateAnalysis({ ...analysis, title: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            需求描述
            <Textarea
              aria-label="需求描述"
              value={analysis.description}
              disabled={!editable}
              onChange={(event) => updateAnalysis({ ...analysis, description: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            验收标准（每行一项）
            <Textarea
              aria-label="验收标准"
              rows={5}
              value={analysis.acceptanceCriteria.join('\n')}
              disabled={!editable}
              onChange={(event) =>
                updateAnalysis({ ...analysis, acceptanceCriteria: event.target.value.split('\n') })
              }
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            设计概览
            <Textarea
              aria-label="设计概览"
              rows={5}
              value={analysis.design.overview}
              disabled={!editable}
              onChange={(event) =>
                updateAnalysis({ ...analysis, design: { ...analysis.design, overview: event.target.value } })
              }
            />
          </label>
          <div className="flex flex-col gap-3 md:col-span-2">
            <h3 className="font-semibold">关键问题</h3>
            {analysis.clarifications.length === 0 && (
              <p className="text-sm text-muted-foreground">暂无待澄清问题。</p>
            )}
            {analysis.clarifications.map((question) => (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3" key={question.id}>
                <label className="text-sm" htmlFor={`prototype-answer-${question.id}`}>
                  {question.question}
                  {question.required ? '（必答）' : '（可选）'}
                </label>
                <Textarea
                  id={`prototype-answer-${question.id}`}
                  value={answers[question.id] ?? ''}
                  disabled={!editable}
                  onChange={(event) => updateAnswer(question.id, event.target.value)}
                />
                {question.suggestedAnswer && (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>建议：{question.suggestedAnswer}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!editable}
                      onClick={() => updateAnswer(question.id, question.suggestedAnswer)}
                    >
                      采用建议
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="text-sm">
            <h3 className="mb-2 font-semibold">原型依据</h3>
            <ul className="list-disc space-y-1 pl-5">
              {analysis.evidence.map((item, index) => (
                <li key={index}>
                  {item.path}：{item.observation}
                </li>
              ))}
            </ul>
          </div>
          <div className="text-sm">
            <h3 className="mb-2 font-semibold">AI 推断</h3>
            <ul className="list-disc space-y-1 pl-5">
              {analysis.inferences.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {!confirmed && (
        <>
          <label className="flex flex-col gap-2 text-sm">
            调整意见（可选）
            <Textarea
              aria-label="调整意见"
              value={feedback}
              disabled={!editable}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="描述遗漏或需调整的内容，让 AI 重新整理。"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!editable || !analysis}
              onClick={() =>
                void run(() => mutate(() => api.savePrototypeImport(importId, payload()), '草稿已保存'))
              }
            >
              保存草稿
            </Button>
            <Button
              variant="outline"
              disabled={!editable}
              onClick={() =>
                void run(() =>
                  mutate(
                    () => api.analyzePrototypeImport(importId, { ...payload(), feedback }),
                    '已开始重新整理',
                    true,
                  ),
                )
              }
            >
              {record.status === 'FAILED' ? '重试整理' : '让 AI 重新整理'}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">
              补传 ZIP（最大 20 MiB）
              <Input
                key={record.materialRevision}
                aria-label="补传原型 ZIP"
                type="file"
                accept=".zip,application/zip"
                disabled={!editable}
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFile(next);
                  setError(
                    next && (!/\.zip$/i.test(next.name) || next.size > MAX_ZIP_BYTES)
                      ? '请选择不超过 20 MiB 的 ZIP 文件'
                      : null,
                  );
                }}
              />
            </label>
            <Button
              variant="outline"
              disabled={!editable || !file || file.size > MAX_ZIP_BYTES || !/\.zip$/i.test(file.name)}
              onClick={() =>
                void run(async () => {
                  const version = epoch.current;
                  let revision = draftRevision.current ?? record.revision;
                  if (dirty.current && analysis) {
                    const saved = await api.savePrototypeImport(importId, payload());
                    if (version !== epoch.current) return;
                    apply(saved, true);
                    revision = saved.revision;
                  }
                  await mutate(
                    () => api.supplementPrototypeImport(importId, revision, file!),
                    '材料已补充，AI 正在重新整理',
                  );
                  if (version === epoch.current) setFile(null);
                })
              }
            >
              上传补充材料
            </Button>
          </div>
          <Button
            disabled={
              !editable ||
              record.status !== 'WAITING_CONFIRMATION' ||
              missingAnswers ||
              !analysis?.title.trim() ||
              !analysis.description.trim() ||
              !analysis.acceptanceCriteria.some((item) => item.trim())
            }
            onClick={() => void run(confirm)}
          >
            确认方案，继续研发
          </Button>
        </>
      )}
      {confirmed &&
        (existingWorkflowId ? (
          <Button asChild>
            <Link to={`/workflow-runs/${existingWorkflowId}`}>继续研发</Link>
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => void run(() => continueWorkflow(record))}>
            继续研发
          </Button>
        ))}
    </section>
  );
}
