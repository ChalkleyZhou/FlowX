import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { FilterBar } from './FilterBar';

interface ListToolbarProps {
  search?: ReactNode;
  filters?: ReactNode;
  className?: string;
}

export function ListToolbar({ search, filters, className }: ListToolbarProps) {
  return (
    <div className={cn('mb-5 rounded-2xl border border-border bg-muted/70 p-3', className)}>
      <div className="flex flex-wrap items-center gap-3">
        {search ? <div className="min-w-[260px] flex-1 xl:max-w-[440px]">{search}</div> : null}
        {filters ? (
          <FilterBar className="inline-flex w-auto flex-1 border-0 bg-transparent p-0 min-[1100px]:flex-none">
            {filters}
          </FilterBar>
        ) : null}
      </div>
    </div>
  );
}
