import type { ReactNode } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import {
  formatReviewFindingStatus,
  formatReviewFindingType,
  formatSeverity,
} from '../utils/label-utils';

interface ReviewFindingCardProps {
  id: string;
  title: string;
  type: string;
  severity: string;
  status: string;
  description: string;
  impactScope?: string[] | null;
  actions: Array<{
    key: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant?: 'default' | 'outline' | 'destructive';
  }>;
  footer?: ReactNode;
}

export function ReviewFindingCard({
  id,
  title,
  type,
  severity,
  status,
  description,
  impactScope,
  actions,
  footer,
}: ReviewFindingCardProps) {
  return (
    <Card className="rounded-2xl border-slate-200 bg-slate-50 shadow-none">
      <CardHeader className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-sm">{title}</CardTitle>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="default">{formatReviewFindingType(type)}</Badge>
            <Badge variant="outline">{formatSeverity(severity)}</Badge>
            <Badge variant="secondary">{formatReviewFindingStatus(status)}</Badge>
          </div>
        </div>
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
          #{id.slice(-6).toUpperCase()}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
      <p className="text-sm leading-6 text-slate-600">{description}</p>

      {impactScope && impactScope.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {impactScope.map((item) => (
            <Badge key={item} variant="outline">
              {item}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {actions.map((action) => (
          <Button
            key={action.key}
            variant={action.variant ?? 'outline'}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </Button>
        ))}
      </div>

      {footer ? <div className="mt-4">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
