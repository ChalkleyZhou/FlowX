import type { ReactNode } from 'react';

interface ListToolbarProps {
  children: ReactNode;
  className?: string;
}

export function ListToolbar({ children, className }: ListToolbarProps) {
  return <div className={['inline-filter-group', 'list-toolbar', className].filter(Boolean).join(' ')}>{children}</div>;
}
