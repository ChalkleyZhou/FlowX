import { cn } from '../../lib/utils';

interface SpinnerProps {
  className?: string;
}

export function Spinner({ className }: SpinnerProps) {
  return (
    <div
      className={cn(
        'h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-primary',
        className,
      )}
      aria-label="Loading"
    />
  );
}
