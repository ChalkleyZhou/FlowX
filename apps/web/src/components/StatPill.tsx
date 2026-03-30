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
    <Card className={cn('rounded-xl border-slate-200 bg-slate-50 shadow-none', className)}>
      <CardContent className="px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
        <div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
      </CardContent>
    </Card>
  );
}
