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
    <Card className={cn('rounded-md border-border bg-card shadow-sm', className)}>
      <CardHeader className="space-y-2 p-5 pb-0">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
        <CardTitle className="text-3xl font-semibold tracking-tight text-foreground">{value}</CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-2">
        {helpText ? <CardDescription className="text-sm leading-6 text-muted-foreground">{helpText}</CardDescription> : null}
      </CardContent>
    </Card>
  );
}
