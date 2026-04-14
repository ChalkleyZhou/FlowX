import type { ReactNode } from 'react';
import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface RepositoryBranchCardProps {
  name: string;
  primaryMeta: ReactNode;
  secondaryMeta?: ReactNode;
  statusLabel?: ReactNode;
  statusVariant?: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';
  description?: ReactNode;
  error?: ReactNode;
  action?: ReactNode;
}

export function RepositoryBranchCard({
  name,
  primaryMeta,
  secondaryMeta,
  statusLabel,
  statusVariant = 'default',
  description,
  error,
  action,
}: RepositoryBranchCardProps) {
  return (
    <Card className="rounded-2xl border-border bg-muted shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-4 p-4 pb-0">
        <div className="min-w-0">
          <CardTitle className="text-sm">{name}</CardTitle>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-3">
        <div className="flex flex-wrap gap-3">
          <Badge variant="outline">{primaryMeta}</Badge>
          {secondaryMeta ? <Badge variant="default">{secondaryMeta}</Badge> : null}
          {statusLabel ? <Badge variant={statusVariant}>{statusLabel}</Badge> : null}
        </div>
        {description ? <div className="mt-2 text-sm leading-6 text-muted-foreground">{description}</div> : null}
        {error ? <div className="mt-2 text-sm leading-6 text-danger">{error}</div> : null}
      </CardContent>
    </Card>
  );
}
