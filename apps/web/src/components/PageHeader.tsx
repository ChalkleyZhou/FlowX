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

/** 各页标题只保留中文名称和操作，不展示英文眉题、说明或装饰图标。标题行与默认按钮同高，避免有无操作时页面内容跳动。 */
export function PageHeader({ title, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex min-h-10 flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-center md:justify-between', className)}>
      <h1 className="flex min-h-10 min-w-0 items-center text-2xl font-semibold leading-8 tracking-tight text-foreground">
        <span className="min-w-0">{title}</span>
      </h1>
      {actions ? <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
