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
    <Card className={cn('rounded-md border-border bg-card shadow-none', className)}>
      <CardHeader className="space-y-1 p-4 pb-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <CardTitle className="text-2xl font-semibold leading-8 tracking-normal text-foreground">{value}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-1.5">
        {helpText ? <CardDescription className="text-xs leading-5 text-muted-foreground">{helpText}</CardDescription> : null}
      </CardContent>
    </Card>
  );
}
