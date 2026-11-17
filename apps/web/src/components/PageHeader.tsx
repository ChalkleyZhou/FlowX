import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}

/** 各页标题只保留中文名称和操作，不展示英文眉题、说明或装饰图标。 */
export function PageHeader({ title, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-center md:justify-between', className)}>
      <h1 className="min-w-0 text-2xl font-semibold leading-8 tracking-tight text-foreground">{title}</h1>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
