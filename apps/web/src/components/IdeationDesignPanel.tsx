import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Textarea } from './ui/textarea';
import { IdeationReviewSidebar } from './IdeationReviewSidebar';
import type {
  DemoPage,
  IdeationSession,
  IdeationSessionEvent,
  LocalDevDetectResponse,
  LocalDevPreviewStatus,
  Repository,
} from '../types';

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
  designRationale: string;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(readString).filter(Boolean);
  }
  const single = readString(value);
  return single ? [single] : [];
}

function parseDesignSpec(output: unknown): DesignSpec | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null;
  }
  const candidate = output as Record<string, unknown>;
  if (!candidate.design || typeof candidate.design !== 'object' || Array.isArray(candidate.design)) {
    return null;
  }
  const designLike = candidate.design as Record<string, unknown>;
  const overview = readString(designLike.overview);
  if (!overview) {
    return null;
  }
  const pages = Array.isArray(designLike.pages)
    ? designLike.pages
        .filter((page): page is Record<string, unknown> => !!page && typeof page === 'object' && !Array.isArray(page))
        .map((page) => ({
          name: readString(page.name),
          route: readString(page.route),
          layout: readString(page.layout),
          keyComponents: readStringArray(page.keyComponents),
          interactions: readStringArray(page.interactions),
        }))
    : [];

  return {
    overview,
    pages,
    demoScenario: readString(designLike.demoScenario),
    designRationale: readString(designLike.designRationale),
  };
}

function parseDemoPages(output: unknown): DemoPage[] | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null;
  }
  const candidate = output as Record<string, unknown>;
  return Array.isArray(candidate.demoPages) ? (candidate.demoPages as DemoPage[]) : null;
}

interface Props {
  requirementId: string;
  ideationStatus: string;
  sessions: IdeationSession[];
  repositories?: Array<{ id: string; repository: Repository }>;
  onUpdated: () => void;
  hideHeader?: boolean;
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

export function IdeationDesignPanel({
  requirementId,
  ideationStatus,
  sessions,
  repositories,
  onUpdated,
  hideHeader = false,
}: Props) {
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<'run' | 'confirm' | 'revise' | null>(null);
  const [expandedPage, setExpandedPage] = useState<number | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [localDetect, setLocalDetect] = useState<LocalDevDetectResponse | null>(null);
  const [localStatus, setLocalStatus] = useState<LocalDevPreviewStatus | null>(null);
  const [demoEvents, setDemoEvents] = useState<IdeationSessionEvent[]>([]);
  const localPollCancelRef = useRef(false);
  const localPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localStartSentRef = useRef(false);

  const designSessions = sessions.filter((s) => s.stage === 'DESIGN');
  const demoSessions = sessions.filter((s) => s.stage === 'DEMO');
  const latestDesignSession = designSessions[designSessions.length - 1];
  const latestDemoSession = demoSessions[demoSessions.length - 1];
  const latestDesignOutputSession = [...designSessions]
    .reverse()
    .find((session) => Boolean(parseDesignSpec(session.output)));
  const latestDemoOutputSession = [...demoSessions]
    .reverse()
    .find((session) => {
      const pages = parseDemoPages(session.output);
      return Boolean(pages && pages.length > 0);
    });
  const isRunning = [...designSessions, ...demoSessions].some((session) => session.status === 'RUNNING');
  const isDesignWaitingConfirmation = ideationStatus === 'DESIGN_WAITING_CONFIRMATION';
  const isDemoWaitingConfirmation = ideationStatus === 'DEMO_WAITING_CONFIRMATION';
  const isDemoPending = ideationStatus === 'DEMO_PENDING';
  const isWaitingConfirmation = isDesignWaitingConfirmation || isDemoWaitingConfirmation;
  const canStartDesign = ideationStatus === 'BRAINSTORM_CONFIRMED';
  const canStartDemo = ideationStatus === 'DESIGN_CONFIRMED';
  const canReviseDesign = ideationStatus === 'DESIGN_WAITING_CONFIRMATION';
  const canReviseDemo = ideationStatus === 'DEMO_WAITING_CONFIRMATION';
  const latestSession =
    isDemoPending || isDemoWaitingConfirmation || canStartDemo
      ? latestDemoSession ?? latestDesignSession
      : latestDesignSession;
  const canRetryAfterFailure =
    latestSession?.status === 'FAILED' && (canStartDesign || canStartDemo || canReviseDesign || canReviseDemo);
  const isConfirmed = ideationStatus === 'DEMO_CONFIRMED' || ideationStatus === 'FINALIZED';

  const design: DesignSpec | null = latestDesignOutputSession ? parseDesignSpec(latestDesignOutputSession.output) : null;

  const demoPages: DemoPage[] | null =
    (latestDemoOutputSession ? parseDemoPages(latestDemoOutputSession.output) : null) ??
    (latestDesignOutputSession ? parseDemoPages(latestDesignOutputSession.output) : null);
  const primaryRepo = repositories?.[0]?.repository;
  const latestDemoEvents = demoEvents.slice(-5).reverse();

  useEffect(() => {
    let cancel = false;
    let intervalRef: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      if (!latestDemoSession?.id) {
        return;
      }
      try {
        const events = await api.getIdeationSessionEvents(requirementId, latestDemoSession.id);
        if (!cancel) {
          setDemoEvents(events);
        }
      } catch {
        if (!cancel) {
          setDemoEvents([]);
        }
      }
    }

    if (!latestDemoSession?.id) {
      setDemoEvents([]);
      return () => {
        cancel = true;
      };
    }

    void poll();
    if (latestDemoSession.status === 'RUNNING' || ideationStatus === 'DEMO_PENDING') {
      intervalRef = setInterval(() => {
        void poll();
      }, 5000);
    }

    return () => {
      cancel = true;
      if (intervalRef) {
        clearInterval(intervalRef);
      }
    };
  }, [ideationStatus, latestDemoSession?.id, latestDemoSession?.status, requirementId]);

  useEffect(() => {
    localPollCancelRef.current = false;
    if (localPollIntervalRef.current) {
      clearInterval(localPollIntervalRef.current);
      localPollIntervalRef.current = null;
    }

    if (
      !demoPages?.length ||
      !primaryRepo?.id ||
      !['DEMO_WAITING_CONFIRMATION', 'DEMO_CONFIRMED', 'FINALIZED'].includes(ideationStatus)
    ) {
      setLocalDetect(null);
      setLocalStatus(null);
      localStartSentRef.current = false;
      return;
    }

    localStartSentRef.current = false;
    setLocalDetect(null);
    setLocalStatus(null);

    void (async () => {
      try {
        const detection = await api.detectLocalDev(primaryRepo.id);
        if (localPollCancelRef.current) {
          return;
        }
        setLocalDetect(detection);
      } catch {
        if (!localPollCancelRef.current) {
          setLocalDetect(null);
        }
      }
    })();

    const poll = async () => {
      if (localPollCancelRef.current || !primaryRepo?.id) {
        return;
      }
      try {
        const status = await api.getLocalDevStatus(primaryRepo.id);
        if (localPollCancelRef.current) {
          return;
        }
        setLocalStatus(status);
        if (status.running && status.previewUrl) {
          if (localPollIntervalRef.current) {
            clearInterval(localPollIntervalRef.current);
            localPollIntervalRef.current = null;
          }
          return;
        }
        if (status.status === 'failed') {
          if (localPollIntervalRef.current) {
            clearInterval(localPollIntervalRef.current);
            localPollIntervalRef.current = null;
          }
          return;
        }
        if ((status.status === 'idle' || status.status === 'stopped') && !localStartSentRef.current) {
          localStartSentRef.current = true;
          try {
            await api.startLocalDevPreview(primaryRepo.id);
            if (!localPollCancelRef.current) {
              setLocalStatus(await api.getLocalDevStatus(primaryRepo.id));
            }
          } catch (error) {
            if (!localPollCancelRef.current) {
              setLocalStatus({
                repositoryId: primaryRepo.id,
                running: false,
                status: 'failed',
                lastError: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      } catch {
        // Transient polling errors are ignored.
      }
    };

    void poll();
    localPollIntervalRef.current = setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      localPollCancelRef.current = true;
      if (localPollIntervalRef.current) {
        clearInterval(localPollIntervalRef.current);
        localPollIntervalRef.current = null;
      }
    };
  }, [demoPages?.length, ideationStatus, primaryRepo?.id, latestSession?.id]);

  async function handleStopLocalDev() {
    if (!primaryRepo?.id) {
      return;
    }
    try {
      await api.stopLocalDevPreview(primaryRepo.id);
      setLocalStatus(await api.getLocalDevStatus(primaryRepo.id));
      localStartSentRef.current = false;
    } catch (error) {
      alert(error instanceof Error ? error.message : '停止本地预览失败');
    }
  }

  async function handleRetryLocalDev() {
    if (!primaryRepo?.id) {
      return;
    }
    localStartSentRef.current = false;
    try {
      await api.startLocalDevPreview(primaryRepo.id);
      setLocalStatus(await api.getLocalDevStatus(primaryRepo.id));
      if (localPollIntervalRef.current) {
        clearInterval(localPollIntervalRef.current);
      }
      localPollIntervalRef.current = setInterval(async () => {
        try {
          const status = await api.getLocalDevStatus(primaryRepo.id);
          setLocalStatus(status);
          if ((status.running && status.previewUrl) || status.status === 'failed') {
            if (localPollIntervalRef.current) {
              clearInterval(localPollIntervalRef.current);
              localPollIntervalRef.current = null;
            }
          }
        } catch {
          // ignore
        }
      }, 2000);
    } catch (error) {
      alert(error instanceof Error ? error.message : '启动本地预览失败');
    }
  }

  async function handleRun() {
    setLoading(true);
    setActiveAction('run');
    try {
      if (canStartDemo) {
        await api.startDemoGeneration(requirementId);
      } else {
        await api.startDesign(requirementId);
      }
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : canStartDemo ? '启动 Demo 生成失败' : '启动设计失败');
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  async function handleRevise() {
    if (!feedback.trim()) return;
    setLoading(true);
    setActiveAction('revise');
    try {
      const revisionFeedback = selectedSection ? `[聚焦区块] ${selectedSection}\n\n${feedback}` : feedback;
      if (canReviseDemo) {
        await api.reviseDemoGeneration(requirementId, revisionFeedback);
      } else {
        await api.reviseDesign(requirementId, revisionFeedback);
      }
      setFeedback('');
      setSelectedSection(null);
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : canReviseDemo ? 'Demo 修订失败' : '设计修订失败');
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  async function handleConfirm() {
    setLoading(true);
    setActiveAction('confirm');
    try {
      if (isDemoWaitingConfirmation) {
        await api.confirmDemoGeneration(requirementId);
      } else {
        await api.confirmDesign(requirementId);
      }
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : isDemoWaitingConfirmation ? '确认 Demo 失败' : '确认设计失败');
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      {!hideHeader && (
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
            {isDemoPending && (
              <Badge variant="default">Demo 生成中</Badge>
            )}
            {isConfirmed && (
              <Badge variant="success">已确认</Badge>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {canStartDesign && !design && (
        <p className="text-sm text-muted-foreground">
          确认产品简报后，先生成并确认 UI 设计，再单独生成 Demo 页面。
        </p>
      )}
      {isDemoPending && (
        <div className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-foreground">
          <p>正在生成 Demo 页面，请稍候。当前阶段会写入本地代码并尝试启动本地预览。</p>
          {primaryRepo && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" type="button" onClick={handleRetryLocalDev}>
                重试本地预览
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={handleStopLocalDev}>
                停止本地进程
              </Button>
            </div>
          )}
        </div>
      )}

      {latestSession?.statusMessage && (isWaitingConfirmation || isRunning || isDemoPending) && (
        <div className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm leading-6 text-foreground">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">本轮状态说明</p>
          <p>{latestSession.statusMessage}</p>
        </div>
      )}
      {latestDemoEvents.length > 0 && (isDemoPending || latestDemoSession?.status === 'RUNNING') && (
        <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-foreground">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">实时进度</p>
          <ul className="space-y-1">
            {latestDemoEvents.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3">
                <span className="font-medium text-foreground">{event.stage}</span>
                <span className="flex-1 text-muted-foreground">{event.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Demo Preview */}
      {demoPages && demoPages.length > 0 && (
        <Card className="border-border shadow-sm">
          <CardContent className="flex flex-col gap-3 p-5">
            <SectionLabel>本地预览</SectionLabel>

            <div className="rounded-md border border-border bg-muted/40 px-4 py-4 text-sm text-foreground">
              <p className="mb-2">
                设计阶段不会触发远程部署。Demo 页面已写入本地仓库；FlowX 会在本机尝试自动识别并启动开发服务（与 API 同机），便于边改边看。
              </p>
              {!primaryRepo?.localPath && (
                <p className="text-xs text-muted-foreground">当前需求未关联可用本地仓库路径，请先完成仓库同步后再预览。</p>
              )}
              {primaryRepo?.localPath && !localDetect && <p className="text-xs text-muted-foreground">正在准备本地预览…</p>}
              {localStatus?.status === 'starting' && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
                    正在启动本地开发服务…
                  </div>
                  <Button variant="ghost" size="sm" type="button" onClick={handleStopLocalDev}>
                    停止进程
                  </Button>
                </div>
              )}
              {localStatus?.status === 'failed' && (
                <div className="mt-2 space-y-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  <p>{localStatus.lastError ?? '本地预览启动失败'}</p>
                  {localStatus.logTail ? (
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-danger/90">
                      {localStatus.logTail.slice(-2000)}
                    </pre>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" type="button" onClick={handleRetryLocalDev}>
                      重试启动
                    </Button>
                    <Button variant="ghost" size="sm" type="button" onClick={handleStopLocalDev}>
                      停止进程
                    </Button>
                  </div>
                </div>
              )}
              {localStatus?.running && localStatus.previewUrl ? (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" type="button" onClick={handleStopLocalDev}>
                      停止本地预览
                    </Button>
                    <a
                      href={localStatus.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      新窗口打开 ↗
                    </a>
                  </div>
                  <div className="overflow-hidden rounded-md border border-border" style={{ height: 480 }}>
                    <iframe
                      src={localStatus.previewUrl}
                      className="h-full w-full"
                      title="本地 Demo 预览"
                      sandbox="allow-scripts allow-same-origin allow-forms"
                    />
                  </div>
                </div>
              ) : null}
            </div>

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

          {(canReviseDesign || canReviseDemo) && isWaitingConfirmation && (
            <IdeationReviewSidebar
              stageLabel={canReviseDemo ? 'Demo 页面' : '设计方案'}
              feedback={feedback}
              selectedSection={selectedSection}
              loading={loading}
              activeAction={activeAction === 'run' ? null : activeAction}
              confirmLabel={isDemoWaitingConfirmation ? '确认当前 Demo' : '确认当前设计'}
              reviseLabel={canReviseDemo ? '发送 Demo 修改意见' : '发送修改意见'}
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
        <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <p>{latestSession.errorMessage}</p>
          {canRetryAfterFailure && (
            <div>
              <Button size="sm" variant="outline" onClick={handleRun} disabled={loading}>
                {loading ? '处理中...' : canStartDemo ? '重新生成 Demo' : '重新生成设计'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {(canStartDesign || canStartDemo) && (
        <Button onClick={handleRun} disabled={loading || isRunning || isDemoPending}>
          {loading ? '处理中...' : canStartDemo ? '生成 Demo 页面' : '生成设计方案'}
        </Button>
      )}

      {canReviseDesign && isWaitingConfirmation && !design && (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            当前轮次未返回可确认的设计内容，无法执行确认。请重新生成一次设计方案。
          </div>
          <Button variant="outline" onClick={handleRun} disabled={loading}>
            {loading ? '处理中...' : '重新生成设计'}
          </Button>
        </div>
      )}
    </div>
  );
}
