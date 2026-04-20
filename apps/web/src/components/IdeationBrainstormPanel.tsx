import { useState } from 'react';
import { api } from '../api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Textarea } from './ui/textarea';
import { IdeationReviewSidebar } from './IdeationReviewSidebar';
import type { IdeationSession } from '../types';

interface BrainstormBrief {
  expandedDescription: string;
  userStories: Array<{ role: string; action: string; benefit: string }>;
  edgeCases: string[];
  successMetrics: string[];
  openQuestions: string[];
  assumptions: string[];
  outOfScope: string[];
}

interface Props {
  requirementId: string;
  ideationStatus: string;
  sessions: IdeationSession[];
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

export function IdeationBrainstormPanel({ requirementId, ideationStatus, sessions, onUpdated }: Props) {
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<'confirm' | 'revise' | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  const brainstormSessions = sessions.filter((s) => s.stage === 'BRAINSTORM');
  const latestSession = brainstormSessions[brainstormSessions.length - 1];
  const isRunning = latestSession?.status === 'RUNNING';
  const isWaitingConfirmation = latestSession?.status === 'WAITING_CONFIRMATION';
  const canStart = ideationStatus === 'NONE';
  const canRevise = ideationStatus === 'BRAINSTORM_WAITING_CONFIRMATION';
  const isConfirmed = ideationStatus === 'BRAINSTORM_CONFIRMED' || ideationStatus === 'DESIGN_PENDING' || ideationStatus === 'DESIGN_WAITING_CONFIRMATION' || ideationStatus === 'DESIGN_CONFIRMED' || ideationStatus === 'FINALIZED';

  const brief: BrainstormBrief | null = latestSession?.output
    ? (latestSession.output as { brief?: BrainstormBrief }).brief ?? null
    : null;

  async function handleRun() {
    setLoading(true);
    try {
      await api.startBrainstorm(requirementId);
      onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : '启动头脑风暴失败');
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
      await api.reviseBrainstorm(requirementId, revisionFeedback);
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
      await api.confirmBrainstorm(requirementId);
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
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Brainstorm</p>
          <h3 className="text-xl font-bold tracking-tight text-foreground">头脑风暴</h3>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Badge variant="outline" className="gap-1.5">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
              AI 思考中
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
      {canStart && !brief && (
        <p className="text-sm text-muted-foreground">
          点击下方按钮，AI 将把简短的需求扩展为完整的产品简报。
        </p>
      )}

      {/* Brief content */}
      {brief && (
        <div className={isWaitingConfirmation ? 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start' : ''}>
          <Card className="border-border shadow-sm">
            <CardContent className="flex flex-col gap-5 p-5">
              <ReviewSection
                title="扩展描述"
                reviewLabel="头脑风暴 / 扩展描述"
                canQuote={isWaitingConfirmation}
                onQuote={setSelectedSection}
              >
                <p className="whitespace-pre-line text-sm leading-6 text-foreground">{brief.expandedDescription}</p>
              </ReviewSection>

              {brief.userStories.length > 0 && (
                <ReviewSection
                  title="用户故事"
                  reviewLabel="头脑风暴 / 用户故事"
                  canQuote={isWaitingConfirmation}
                  onQuote={setSelectedSection}
                >
                  <ul className="flex flex-col gap-1.5">
                    {brief.userStories.map((story, i) => (
                      <li key={i} className="text-sm text-foreground">
                        作为<strong className="font-semibold text-foreground">{story.role}</strong>，我希望<strong className="font-semibold text-foreground">{story.action}</strong>，以便<strong className="font-semibold text-foreground">{story.benefit}</strong>
                      </li>
                    ))}
                  </ul>
                </ReviewSection>
              )}

              {brief.edgeCases.length > 0 && (
                <ReviewSection
                  title="边界情况"
                  reviewLabel="头脑风暴 / 边界情况"
                  canQuote={isWaitingConfirmation}
                  onQuote={setSelectedSection}
                >
                  <ul className="list-inside list-disc space-y-0.5">
                    {brief.edgeCases.map((item, i) => (
                      <li key={i} className="text-sm text-foreground">{item}</li>
                    ))}
                  </ul>
                </ReviewSection>
              )}

              {brief.successMetrics.length > 0 && (
                <ReviewSection
                  title="成功指标"
                  reviewLabel="头脑风暴 / 成功指标"
                  canQuote={isWaitingConfirmation}
                  onQuote={setSelectedSection}
                >
                  <ul className="list-inside list-disc space-y-0.5">
                    {brief.successMetrics.map((item, i) => (
                      <li key={i} className="text-sm text-foreground">{item}</li>
                    ))}
                  </ul>
                </ReviewSection>
              )}

              {brief.openQuestions.length > 0 && (
                <ReviewSection
                  title="待确认问题"
                  reviewLabel="头脑风暴 / 待确认问题"
                  canQuote={isWaitingConfirmation}
                  onQuote={setSelectedSection}
                >
                  <ul className="list-inside list-disc space-y-0.5">
                    {brief.openQuestions.map((item, i) => (
                      <li key={i} className="text-sm text-warning">{item}</li>
                    ))}
                  </ul>
                </ReviewSection>
              )}

              {brief.assumptions.length > 0 && (
                <ReviewSection
                  title="假设"
                  reviewLabel="头脑风暴 / 假设"
                  canQuote={isWaitingConfirmation}
                  onQuote={setSelectedSection}
                >
                  <ul className="list-inside list-disc space-y-0.5">
                    {brief.assumptions.map((item, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{item}</li>
                    ))}
                  </ul>
                </ReviewSection>
              )}

              {brief.outOfScope.length > 0 && (
                <ReviewSection
                  title="不在范围内"
                  reviewLabel="头脑风暴 / 不在范围内"
                  canQuote={isWaitingConfirmation}
                  onQuote={setSelectedSection}
                >
                  <ul className="list-inside list-disc space-y-0.5">
                    {brief.outOfScope.map((item, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{item}</li>
                    ))}
                  </ul>
                </ReviewSection>
              )}
            </CardContent>
          </Card>

          {canRevise && isWaitingConfirmation && (
            <IdeationReviewSidebar
              stageLabel="头脑风暴"
              feedback={feedback}
              selectedSection={selectedSection}
              loading={loading}
              activeAction={activeAction}
              confirmLabel="确认当前简报"
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
          {loading ? '处理中...' : '启动头脑风暴'}
        </Button>
      )}

      {canRevise && isWaitingConfirmation && !brief && (
        <div className="flex flex-col gap-3">
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="输入修改意见，AI 将据此重新生成..."
            rows={3}
          />
          <div className="flex gap-2">
            <Button onClick={handleConfirm} disabled={loading}>
              {loading ? '处理中...' : '确认简报'}
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
