import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { cn } from '../lib/utils';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  helpText?: string;
  className?: string;
}

export function MetricCard({ label, value, helpText, className }: MetricCardProps) {
  return (
    <Card className={cn('rounded-2xl border-slate-200 bg-white shadow-sm', className)}>
      <CardHeader className="space-y-2 p-5 pb-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
        <CardTitle className="text-3xl font-semibold tracking-tight text-slate-950">{value}</CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-2">
        {helpText ? <CardDescription className="text-sm leading-6 text-slate-600">{helpText}</CardDescription> : null}
      </CardContent>
    </Card>
  );
}
