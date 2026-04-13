import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  titleClassName?: string;
  descriptionClassName?: string;
  className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  titleClassName,
  descriptionClassName,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      {eyebrow ? (
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{eyebrow}</div>
      ) : null}
      <div className="space-y-2">
        <div className={cn('text-balance font-semibold tracking-tight text-foreground', titleClassName)}>{title}</div>
        {description ? (
          <div className={cn('max-w-3xl text-sm leading-6 text-muted-foreground', descriptionClassName)}>{description}</div>
        ) : null}
      </div>
    </div>
  );
}
