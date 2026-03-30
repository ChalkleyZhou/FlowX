import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { SectionHeading } from './ui/section-heading';

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  extra?: ReactNode;
  className?: string;
}

export function SectionHeader({ eyebrow, title, description, extra, className }: SectionHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 md:flex-row md:items-start md:justify-between', className)}>
      <SectionHeading
        eyebrow={eyebrow}
        title={title}
        description={description}
        titleClassName="text-xl"
        descriptionClassName="max-w-none"
      />
      {extra ? <div className="flex shrink-0 flex-wrap items-center gap-3">{extra}</div> : null}
    </div>
  );
}
