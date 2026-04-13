import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Card, CardContent } from './ui/card';

interface StatPillProps {
  label: string;
  value: ReactNode;
  className?: string;
}

export function StatPill({ label, value, className }: StatPillProps) {
  return (
    <Card className={cn('rounded-xl border-border bg-muted shadow-none', className)}>
      <CardContent className="px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
        <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}
