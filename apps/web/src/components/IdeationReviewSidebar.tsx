import { X } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Textarea } from './ui/textarea';

interface Props {
  stageLabel: string;
  feedback: string;
  selectedSection: string | null;
  loading: boolean;
  activeAction?: 'confirm' | 'revise' | null;
  confirmLabel: string;
  reviseLabel: string;
  onFeedbackChange: (value: string) => void;
  onClearSection: () => void;
  onConfirm: () => void;
  onRevise: () => void;
}

export function IdeationReviewSidebar({
  stageLabel,
  feedback,
  selectedSection,
  loading,
  activeAction = null,
  confirmLabel,
  reviseLabel,
  onFeedbackChange,
  onClearSection,
  onConfirm,
  onRevise,
}: Props) {
  const hasFeedback = feedback.trim().length > 0;
  const confirmButton = (
    <Button
      key="confirm"
      data-action-role={hasFeedback ? 'secondary' : 'primary'}
      variant={hasFeedback ? 'outline' : 'default'}
      onClick={onConfirm}
      disabled={loading}
    >
      {activeAction === 'confirm' ? '处理中...' : confirmLabel}
    </Button>
  );
  const reviseButton = (
    <Button
      key="revise"
      data-action-role={hasFeedback ? 'primary' : 'secondary'}
      variant={hasFeedback ? 'default' : 'outline'}
      onClick={onRevise}
      disabled={loading || !hasFeedback}
    >
      {activeAction === 'revise' ? '处理中...' : reviseLabel}
    </Button>
  );
  return (
    <Card className="border-border shadow-sm lg:sticky lg:top-6">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Review</p>
          <div>
            <h4 className="text-base font-semibold text-foreground">反馈面板</h4>
            <p className="text-sm text-muted-foreground">边看边改，不离开当前内容上下文。</p>
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">当前阶段</p>
          <p className="mt-1 text-sm font-medium text-foreground">{stageLabel}</p>
        </div>

        {selectedSection && (
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">已引用</p>
                <p className="mt-1 text-sm text-foreground">{selectedSection}</p>
              </div>
              <button
                type="button"
                onClick={onClearSection}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
                aria-label="清除引用"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">整体反馈</p>
          <Textarea
            value={feedback}
            onChange={(event) => onFeedbackChange(event.target.value)}
            placeholder="说明这版哪里不对、希望怎么改。可以先写整体意见，再引用左侧具体区块。"
            rows={8}
            className="min-h-[220px] resize-y"
          />
        </div>

        <div className="flex flex-col gap-2">
          {reviseButton}
          {confirmButton}
        </div>
      </CardContent>
    </Card>
  );
}
