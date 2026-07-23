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
    <Card className={cn('rounded-md border-border bg-muted/50 shadow-none', className)}>
      <CardContent className="px-3 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
        <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}
