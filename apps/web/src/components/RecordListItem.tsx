import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface RecordListItemProps {
  className?: string;
  title: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
  interactive?: boolean;
}

export function RecordListItem({
  className,
  title,
  badges,
  description,
  details,
  actions,
  interactive = false,
}: RecordListItemProps) {
  return (
    <Card
      className={cn(
        'rounded-md border-border bg-card shadow-none',
        interactive && 'transition-colors hover:border-primary/50 hover:bg-primary/[0.02]',
        className,
      )}
    >
      <CardHeader className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <CardTitle className="text-base leading-6">{title}</CardTitle>
          {badges ? <div className="flex flex-wrap gap-1.5">{badges}</div> : null}
        </div>
        {actions ? <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-end gap-2 max-[1180px]:min-h-0 max-[1180px]:justify-start">{actions}</div> : null}
      </CardHeader>
      {(description || details) ? (
        <CardContent className="space-y-1.5 p-4 pt-0">
          {description ? <div className="flex min-w-0 flex-col gap-1 text-sm leading-6 text-muted-foreground">{description}</div> : null}
          {details ? <div className="flex min-w-0 flex-col gap-1 text-sm leading-6 text-muted-foreground">{details}</div> : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
