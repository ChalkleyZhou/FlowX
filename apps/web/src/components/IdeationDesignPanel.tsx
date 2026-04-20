import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Textarea } from './ui/textarea';
import { IdeationReviewSidebar } from './IdeationReviewSidebar';
import type { DemoPage, IdeationSession, Repository } from '../types';

interface DesignSpec {
  overview: string;
  pages: Array<{
    name: string;
    route: string;
    layout: string;
    keyComponents: string[];
    interactions: string[];
  }>;
  demoScenario: string;
  dataModels: string[];
  apiEndpoints: Array<{
    method: string;
    path: string;
    purpose: string;
  }>;
  designRationale: string;
}

interface Props {
  requirementId: string;
  ideationStatus: string;
  sessions: IdeationSession[];
  repositories?: Array<{ id: string; repository: Repository }>;
  onUpdated: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{children}</p>;
}

function ReviewSection({
  title,
  reviewLabel,
  canQuote,
  onQuote,
  children,
}: {
  title: string;
  reviewLabel: string;
  canQuote: boolean;
  onQuote: (label: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <SectionLabel>{title}</SectionLabel>
        {canQuote && (
          <button
            type="button"
            onClick={() => onQuote(reviewLabel)}
            aria-label={`引用到反馈: ${reviewLabel}`}
            className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            引用到反馈
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

const methodBadgeVariant: Record<string, 'success' | 'default' | 'warning' | 'destructive' | 'outline'> = {
  GET: 'success',
  POST: 'default',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'destructive',
};

type PreviewState = 'idle' | 'deploying' | 'ready' | 'failed' | 'no_config';

export function IdeationDesignPanel({ requirementId, ideationStatus, sessions, repositories, onUpdated }: Props) {
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<'confirm' | 'revise' | null>(null);
  const [expandedPage, setExpandedPage] = useState<number | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingStartRef = useRef<number>(0);

  const designSessions = sessions.filter((s) => s.stage === 'DESIGN');
  const latestSession = designSessions[designSessions.length - 1];
  const isRunning = latestSession?.status === 'RUNNING';
  const isWaitingConfirmation = latestSession?.status === 'WAITING_CONFIRMATION';
  const canStart = ideationStatus === 'BRAINSTORM_CONFIRMED';
  const canRevise = ideationStatus === 'DESIGN_WAITING_CONFIRMATION';
  const isConfirmed = ideationStatus === 'DESIGN_CONFIRMED' || ideationStatus === 'FINALIZED';

  const design: DesignSpec | null = latestSession?.output
    ? (latestSession.output as { design?: DesignSpec }).design ?? null
    : null;

  const demoPages: DemoPage[] | null = latestSession?.output
    ? (latestSession.output as { demoPages?: DemoPage[] }).demoPages ?? null
    : null;

  // Clear polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Start polling when design session completes with demo pages
  useEffect(() => {
    if (isWaitingConfirmation && demoPages && demoPages.length > 0 && previewState === 'idle') {
      startPolling();
    }
  }, [isWaitingConfirmation, demoPages]);

  function startPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    setPreviewState('deploying');
    pollingStartRef.current = Date.now();

    pollingRef.current = setInterval(async () => {
      // Timeout after 5 minutes
      if (Date.now() - pollingStartRef.current > 5 * 60 * 1000) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        setPreviewState('failed');
        return;
      }

      try {
        const firstRepo = repositories?.[0]?.repository;
        if (!firstRepo) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setPreviewState('no_config');
          return;
        }

        const jobs = await api.getDemoDeployStatus(firstRepo.id);
        const latestJob = jobs[0];

        if (latestJob?.externalJobUrl) {
          setPreviewUrl(latestJob.externalJobUrl);
          setPreviewState('ready');
          if (pollingRef.current) clearInterval(pollingRef.current);
        } else if (latestJob?.status === 'FAILED') {
          setPreviewState('failed');
          if (pollingRef.current) clearInterval(pollingRef.current);
        }
      } catch {
        // Continue polling on transient errors
      }
    }, 3000);
  }

  async function handleRun() {
    setLoading(true);
    setPreviewState('idle');
    setPreviewUrl(null);
    try {
      await api.startDesign(requirementId);
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : '启动设计失败');
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  async function handleRevise() {
    if (!feedback.trim()) return;
    setLoading(true);
    setActiveAction('revise');
    setPreviewState('idle');
    setPreviewUrl(null);
    try {
      const revisionFeedback = selectedSection ? `[聚焦区块] ${selectedSection}\n\n${feedback}` : feedback;
      await api.reviseDesign(requirementId, revisionFeedback);
      setFeedback('');
      setSelectedSection(null);
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : '修订失败');
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  async function handleConfirm() {
    setLoading(true);
    setActiveAction('confirm');
    try {
      await api.confirmDesign(requirementId);
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : '确认失败');
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">UI Design</p>
          <h3 className="text-xl font-bold tracking-tight text-foreground">UI 设计 & Demo</h3>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Badge variant="outline" className="gap-1.5">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
              AI 生成中
            </Badge>
          )}
          {isWaitingConfirmation && (
            <Badge variant="warning">待确认</Badge>
          )}
          {isConfirmed && (
            <Badge variant="success">已确认</Badge>
          )}
        </div>
      </div>

      {/* Empty state */}
      {canStart && !design && (
        <p className="text-sm text-muted-foreground">
          确认产品简报后，点击下方按钮生成 UI 设计规格和 Demo 页面。
        </p>
      )}

      {/* Demo Preview */}
      {demoPages && demoPages.length > 0 && (
        <Card className="border-border shadow-sm">
          <CardContent className="flex flex-col gap-3 p-5">
            <SectionLabel>Demo 预览</SectionLabel>

            {previewState === 'ready' && previewUrl && (
              <div className="flex flex-col gap-2">
                <div className="overflow-hidden rounded-md border border-border" style={{ height: 480 }}>
                  <iframe
                    src={previewUrl}
                    className="h-full w-full"
                    title="Demo 预览"
                    sandbox="allow-scripts allow-same-origin"
                  />
                </div>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  新窗口打开 ↗
                </a>
              </div>
            )}

            {previewState === 'deploying' && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-4 py-8 text-sm text-muted-foreground">
                <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-primary" />
                Demo 部署中，请稍候...
              </div>
            )}

            {previewState === 'failed' && (
              <div className="flex flex-col gap-2 rounded-md border border-danger/30 bg-danger/10 px-4 py-4 text-sm text-danger">
                <p>部署超时或失败，请稍后手动查看。</p>
                <Button variant="outline" size="sm" onClick={startPolling}>
                  重试
                </Button>
              </div>
            )}

            {previewState === 'no_config' && (
              <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-4 text-sm text-warning">
                仓库未配置部署，无法预览 Demo。请联系管理员配置 RepositoryDeployConfig。
              </div>
            )}

            {(previewState === 'idle' || previewState === 'failed' || previewState === 'no_config') && !previewUrl && (
              <div className="flex flex-col gap-2">
                <SectionLabel>Demo 页面代码</SectionLabel>
                {demoPages.map((page, i) => (
                  <div key={i} className="overflow-hidden rounded-md border border-border">
                    <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5">
                      <span className="text-xs font-medium text-foreground">{page.componentName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{page.route}</span>
                    </div>
                    <pre className="max-h-64 overflow-auto bg-card px-3 py-2 font-mono text-xs leading-5 text-foreground">
                      {page.componentCode}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Design content */}
      {design && (
        <div className={isWaitingConfirmation ? 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start' : ''}>
          <Card className="border-border shadow-sm">
            <CardContent className="flex flex-col gap-5 p-5">
              <ReviewSection
                title="设计概述"
                reviewLabel="设计方案 / 设计概述"
                canQuote={isWaitingConfirmation}
                onQuote={setSelectedSection}
              >
                <p className="whitespace-pre-line text-sm leading-6 text-foreground">{design.overview}</p>
              </ReviewSection>

              {design.pages.length > 0 && (
                <ReviewSection
                  title="页面设计"
                  reviewLabel="设计方案 / 页面设计"
                  canQuote={isWaitingConfirmation}
                  onQuote={setSelectedSection}
                >
                  <div className="flex flex-col gap-2">
                    {design.pages.map((page, i) => (
                      <div key={i} className="overflow-hidden rounded-md border border-border">
                        <button
                          onClick={() => setExpandedPage(expandedPage === i ? null : i)}
                          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span>{page.name} <span className="font-normal text-muted-foreground">{page.route}</span></span>
                          <span className="text-muted-foreground">{expandedPage === i ? '▲' : '▼'}</span>
                        </button>
                        {expandedPage === i && (
                          <div className="flex flex-col gap-3 border-t border-border bg-muted/50 p-4">
                            <div>
                              <SectionLabel>布局线框</SectionLabel>
                              <pre className="whitespace-pre-wrap rounded-md border border-border bg-card px-3 py-2 font-mono text-xs leading-5 text-foreground">{page.layout}</pre>
                            </div>
                            {page.keyComponents.length > 0 && (
                              <div>
                                <SectionLabel>关键组件</SectionLabel>
                                <div className="flex flex-wrap gap-1.5">
                                  {page.keyComponents.map((comp, j) => (
                                    <Badge key={j} variant="secondary">{comp}</Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            {page.interactions.length > 0 && (
                              <div>
                                <SectionLabel>交互</SectionLabel>
                                <ul className="list-inside list-disc space-y-0.5">
                                  {page.interactions.map((interaction, j) => (
                                    <li key={j} className="text-xs text-foreground">{interaction}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ReviewSection>
              )}

              {design.demoScenario && (
                <ReviewSection
                  title="Demo 场景"
                  reviewLabel="设计方案 / Demo 场景"
                  canQuote={isWaitingConfirmation}
                  onQuote={setSelectedSection}
                >
                  <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm leading-6 text-foreground">{design.demoScenario}</pre>
                </ReviewSection>
              )}

              {design.dataModels.length > 0 && (
                <ReviewSection
                  title="数据模型"
                  reviewLabel="设计方案 / 数据模型"
                  canQuote={isWaitingConfirmation}
                  onQuote={setSelectedSection}
                >
                  <ul className="list-inside list-disc space-y-0.5">
                    {design.dataModels.map((model, i) => (
                      <li key={i} className="font-mono text-xs text-foreground">{model}</li>
                    ))}
                  </ul>
                </ReviewSection>
              )}

              {design.apiEndpoints.length > 0 && (
                <ReviewSection
                  title="API 端点"
                  reviewLabel="设计方案 / API 端点"
                  canQuote={isWaitingConfirmation}
                  onQuote={setSelectedSection}
                >
                  <div className="flex flex-col gap-1.5">
                    {design.apiEndpoints.map((endpoint, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Badge variant={methodBadgeVariant[endpoint.method] ?? 'outline'} className="font-mono px-1.5 py-0.5">
                          {endpoint.method}
                        </Badge>
                        <span className="font-mono text-foreground">{endpoint.path}</span>
                        <span className="text-muted-foreground">— {endpoint.purpose}</span>
                      </div>
                    ))}
                  </div>
                </ReviewSection>
              )}

              {design.designRationale && (
                <ReviewSection
                  title="设计理由"
                  reviewLabel="设计方案 / 设计理由"
                  canQuote={isWaitingConfirmation}
                  onQuote={setSelectedSection}
                >
                  <p className="text-sm text-foreground">{design.designRationale}</p>
                </ReviewSection>
              )}
            </CardContent>
          </Card>

          {canRevise && isWaitingConfirmation && (
            <IdeationReviewSidebar
              stageLabel="设计方案"
              feedback={feedback}
              selectedSection={selectedSection}
              loading={loading}
              activeAction={activeAction}
              confirmLabel="确认当前设计"
              reviseLabel="发送修改意见"
              onFeedbackChange={setFeedback}
              onClearSection={() => setSelectedSection(null)}
              onConfirm={handleConfirm}
              onRevise={handleRevise}
            />
          )}
        </div>
      )}

      {/* Error */}
      {latestSession?.status === 'FAILED' && latestSession.errorMessage && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {latestSession.errorMessage}
        </div>
      )}

      {/* Actions */}
      {canStart && (
        <Button onClick={handleRun} disabled={loading}>
          {loading ? '处理中...' : '生成设计方案'}
        </Button>
      )}

      {canRevise && isWaitingConfirmation && !design && (
        <div className="flex flex-col gap-3">
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="输入修改意见，AI 将据此重新生成..."
            rows={3}
          />
          <div className="flex gap-2">
            <Button onClick={handleConfirm} disabled={loading}>
              {loading ? '处理中...' : '确认设计'}
            </Button>
            <Button variant="outline" onClick={handleRevise} disabled={loading || !feedback.trim()}>
              {loading ? '处理中...' : '修改并重新生成'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
