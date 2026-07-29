import { useState } from 'react';
import { api } from '../api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { IdeationReviewSidebar } from './IdeationReviewSidebar';
import type { IdeationSession, Repository } from '../types';

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

interface Props {
  requirementId: string;
  ideationStatus: string;
  sessions: IdeationSession[];
  repositories?: Array<{ id: string; repository: Repository }>;
  onUpdated: () => void;
  hideHeader?: boolean;
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

export function IdeationDesignPanel({ requirementId, ideationStatus, sessions, onUpdated, hideHeader = false }: Props) {
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<'run' | 'confirm' | 'revise' | null>(null);
  const [expandedPage, setExpandedPage] = useState<number | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  const designSessions = sessions.filter((s) => s.stage === 'DESIGN');
  const latestSession = designSessions[designSessions.length - 1];
  const latestOutputSession = [...designSessions].reverse().find((session) => Boolean(parseDesignSpec(session.output)));
  const isRunning = designSessions.some((session) => session.status === 'RUNNING');
  const isWaitingConfirmation = ideationStatus === 'DESIGN_WAITING_CONFIRMATION';
  const canStartDesign = ideationStatus === 'BRAINSTORM_CONFIRMED';
  const canReviseDesign = ideationStatus === 'DESIGN_WAITING_CONFIRMATION';
  const canRetryAfterFailure = latestSession?.status === 'FAILED' && (canStartDesign || canReviseDesign);
  const isConfirmed = ideationStatus === 'DESIGN_CONFIRMED' || ideationStatus === 'FINALIZED';
  const design: DesignSpec | null = latestOutputSession ? parseDesignSpec(latestOutputSession.output) : null;

  async function handleRun() {
    setLoading(true);
    setActiveAction('run');
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
    try {
      const revisionFeedback = selectedSection ? `[聚焦区块] ${selectedSection}\n\n${feedback}` : feedback;
      await api.reviseDesign(requirementId, revisionFeedback);
      setFeedback('');
      setSelectedSection(null);
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : '设计修订失败');
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
      alert(err instanceof Error ? err.message : '确认设计失败');
    } finally {
      setLoading(false);
      setActiveAction(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">UI Design</p>
            <h3 className="text-xl font-bold tracking-tight text-foreground">UI 设计</h3>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Badge variant="outline" className="gap-1.5">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                AI 生成中
              </Badge>
            )}
            {isWaitingConfirmation && <Badge variant="warning">待确认</Badge>}
            {isConfirmed && <Badge variant="success">已确认</Badge>}
          </div>
        </div>
      )}

      {canStartDesign && !design && (
        <p className="text-sm text-muted-foreground">确认产品简报后，生成并确认 UI 设计，完成 ideation 阶段。</p>
      )}

      {latestSession?.statusMessage && (isWaitingConfirmation || isRunning) && (
        <div className="rounded-md border border-border bg-muted/50 px-4 py-3 text-sm leading-6 text-foreground">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">本轮状态说明</p>
          <p>{latestSession.statusMessage}</p>
        </div>
      )}

      {design && (
        <div className={isWaitingConfirmation ? 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start' : ''}>
          <Card className="border-border">
            <CardContent className="flex flex-col gap-5 p-5">
              <ReviewSection title="设计概述" reviewLabel="设计方案 / 设计概述" canQuote={isWaitingConfirmation} onQuote={setSelectedSection}>
                <p className="whitespace-pre-line text-sm leading-6 text-foreground">{design.overview}</p>
              </ReviewSection>

              {design.pages.length > 0 && (
                <ReviewSection title="页面设计" reviewLabel="设计方案 / 页面设计" canQuote={isWaitingConfirmation} onQuote={setSelectedSection}>
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

              {design.designRationale && (
                <ReviewSection title="设计理由" reviewLabel="设计方案 / 设计理由" canQuote={isWaitingConfirmation} onQuote={setSelectedSection}>
                  <p className="text-sm text-foreground">{design.designRationale}</p>
                </ReviewSection>
              )}
            </CardContent>
          </Card>

          {canReviseDesign && isWaitingConfirmation && (
            <IdeationReviewSidebar
              stageLabel="设计方案"
              feedback={feedback}
              selectedSection={selectedSection}
              loading={loading}
              activeAction={activeAction === 'run' ? null : activeAction}
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

      {latestSession?.status === 'FAILED' && latestSession.errorMessage && (
        <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <p>{latestSession.errorMessage}</p>
          {canRetryAfterFailure && (
            <div>
              <Button size="sm" variant="outline" onClick={handleRun} disabled={loading}>
                {loading ? '处理中...' : '重新生成设计'}
              </Button>
            </div>
          )}
        </div>
      )}

      {canStartDesign && (
        <Button onClick={handleRun} disabled={loading || isRunning}>
          {loading ? '处理中...' : '生成设计方案'}
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
