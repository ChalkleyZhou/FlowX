import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { cn } from '../lib/utils';

interface ContextPanelProps {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function ContextPanel({ eyebrow, title, description, children, className }: ContextPanelProps) {
  return (
    <Card className={cn('border-border bg-card shadow-sm', className)}>
      <CardHeader className="p-5">
        <div className="space-y-2">
          {eyebrow ? (
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{eyebrow}</div>
          ) : null}
          <div className="space-y-1.5">
            <CardTitle className="text-lg">{title}</CardTitle>
            {description ? (
              <CardDescription className="max-w-none text-sm leading-6 text-muted-foreground">{description}</CardDescription>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-5 pt-0">{children}</CardContent>
    </Card>
  );
}
