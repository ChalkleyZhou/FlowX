import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { SectionHeading } from './ui/section-heading';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, icon: Icon, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-start md:justify-between', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border bg-muted text-foreground">
            <Icon aria-hidden="true" className="h-5 w-5" />
          </div>
        ) : null}
        <SectionHeading
          eyebrow={eyebrow}
          title={title}
          description={description}
          titleClassName="text-2xl font-semibold leading-8"
        />
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}
