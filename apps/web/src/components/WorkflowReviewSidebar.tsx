import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Textarea } from './ui/textarea';

export interface WorkflowWorkspaceAction {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  variant?: 'primary' | 'default';
}

interface Props {
  stageTitle: string;
  stageStatusLabel?: string;
  helperText: string;
  feedbackText: string;
  feedbackPlaceholder: string;
  onFeedbackChange: (value: string) => void;
  primaryAction: WorkflowWorkspaceAction;
  secondaryActions: WorkflowWorkspaceAction[];
}

function renderAction(action: WorkflowWorkspaceAction) {
  return (
    <Button
      key={action.key}
      variant={action.danger ? 'destructive' : action.variant === 'primary' ? 'default' : 'outline'}
      onClick={action.onClick}
      disabled={action.disabled}
      data-action-key={action.key}
    >
      {action.loading ? '处理中...' : action.label}
    </Button>
  );
}

export function WorkflowReviewSidebar({
  stageTitle,
  stageStatusLabel,
  helperText,
  feedbackText,
  feedbackPlaceholder,
  onFeedbackChange,
  primaryAction,
  secondaryActions,
}: Props) {
  return (
    <Card className="border-border shadow-sm">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Workflow Review</p>
          <div>
            <h4 className="text-base font-semibold text-foreground">工作流反馈区</h4>
            <p className="text-sm text-muted-foreground">{helperText}</p>
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">当前阶段</p>
          <p className="mt-1 text-sm font-medium text-foreground">{stageTitle}</p>
          {stageStatusLabel ? <p className="mt-1 text-xs text-muted-foreground">{stageStatusLabel}</p> : null}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">修改意见</p>
          <Textarea
            value={feedbackText}
            onChange={(event) => onFeedbackChange(event.target.value)}
            placeholder={feedbackPlaceholder}
            rows={8}
            className="min-h-[220px] resize-y"
          />
        </div>

        <div className="flex flex-col gap-2">
          {renderAction(primaryAction)}
          {secondaryActions.map((action) => renderAction(action))}
        </div>
      </CardContent>
    </Card>
  );
}
