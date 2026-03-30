import type { ReactNode } from 'react';
import { Badge } from './ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { cn } from '../lib/utils';

interface DetailHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  badges?: Array<{ key: string; label: ReactNode; variant?: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' }>;
  actions?: ReactNode;
  className?: string;
}

export function DetailHeader({ eyebrow, title, description, badges, actions, className }: DetailHeaderProps) {
  return (
    <Card className={cn('border-slate-200 bg-white shadow-sm', className)}>
      <CardContent className="flex flex-col gap-5 p-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-3">
          <CardHeader className="space-y-3 p-0">
            {eyebrow ? (
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">{eyebrow}</div>
            ) : null}
            <div className="space-y-2">
              <CardTitle className="text-xl font-semibold tracking-tight md:text-2xl">{title}</CardTitle>
              {description ? (
                <CardDescription className="max-w-3xl text-sm leading-6 text-slate-600">{description}</CardDescription>
              ) : null}
            </div>
          </CardHeader>
          {badges?.length ? (
            <div className="flex flex-wrap items-center gap-2">
              {badges.map((badge) => (
                <Badge key={badge.key} variant={badge.variant ?? 'default'}>
                  {badge.label}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
      </CardContent>
    </Card>
  );
}
