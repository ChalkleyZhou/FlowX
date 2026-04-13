import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface EmptyStateProps {
  title?: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title = '暂无内容',
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted px-6 py-10 text-center',
        className,
      )}
    >
      <div className="max-w-md space-y-2">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
