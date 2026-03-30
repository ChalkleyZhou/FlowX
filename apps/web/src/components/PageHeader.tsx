import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { SectionHeading } from './ui/section-heading';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-5 py-1 md:flex-row md:items-start md:justify-between', className)}>
      <SectionHeading
        eyebrow={eyebrow}
        title={title}
        description={description}
        titleClassName="text-3xl font-bold"
      />
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}
