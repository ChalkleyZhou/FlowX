import { cn } from '../lib/utils';

type FlowXLogoProps = {
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
  showWordmark?: boolean;
  theme?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
};

const sizeMap = {
  sm: { icon: 'w-[34px] h-[34px]', word: 'text-lg', tagline: 'text-[10px]' },
  md: { icon: 'w-10 h-10', word: 'text-lg', tagline: 'text-xs' },
  lg: { icon: 'w-14 h-14', word: 'text-[28px]', tagline: 'text-xs' },
} as const;

export function FlowXLogo({
  className,
  iconClassName,
  labelClassName,
  showWordmark = true,
  theme = 'light',
  size = 'md',
}: FlowXLogoProps) {
  const s = sizeMap[size];
  return (
    <div className={cn('inline-flex min-w-0 items-center gap-3', size === 'lg' && 'gap-4', className)}>
      <svg
        viewBox="0 0 96 96"
        aria-hidden="true"
        className={cn('shrink-0 drop-shadow-[0_10px_20px_rgba(37,99,235,0.14)]', s.icon, iconClassName)}
        role="img"
      >
        <defs>
          <linearGradient id="flowx-tile" x1="14" y1="10" x2="84" y2="86" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0f172a" />
            <stop offset="0.5" stopColor="#1d4ed8" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
          <linearGradient id="flowx-stream-a" x1="8" y1="32" x2="72" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#c4f1ff" />
          </linearGradient>
          <linearGradient id="flowx-stream-b" x1="18" y1="62" x2="74" y2="62" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7dd3fc" />
            <stop offset="1" stopColor="#ffffff" />
          </linearGradient>
          <linearGradient id="flowx-accent" x1="48" y1="20" x2="72" y2="74" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f8fafc" />
            <stop offset="1" stopColor="#bfdbfe" />
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="84" height="84" rx="26" fill="url(#flowx-tile)" />
        <path
          d="M22 28C30.6 28 35.4 28 40 30.8C44.9 33.8 48.2 39.5 51.1 46.7L54.3 54.5C56.6 60 59.2 64 63.6 66.2C67.3 68 71.4 68 77 68"
          fill="none"
          stroke="url(#flowx-stream-a)"
          strokeLinecap="round"
          strokeWidth="10"
        />
        <path
          d="M21 67H34.8C40.3 67 44.4 65.5 47.6 62.4C51 59.1 53.8 54.6 56.7 49.2C59.1 44.7 61.2 41.5 63.8 39C67.1 35.9 71.1 34 77 34"
          fill="none"
          stroke="url(#flowx-stream-b)"
          strokeLinecap="round"
          strokeWidth="10"
        />
        <path
          d="M58 21L76 39M76 57L58 75"
          fill="none"
          stroke="url(#flowx-accent)"
          strokeLinecap="round"
          strokeWidth="8"
        />
        <circle cx="22" cy="28" r="4" fill="#dbeafe" />
        <circle cx="21" cy="67" r="4" fill="#67e8f9" />
      </svg>
      {showWordmark ? (
        <div className={cn('min-w-0', labelClassName)}>
          <div className={cn(
            'leading-none font-extrabold tracking-tight',
            s.word,
            theme === 'dark' ? 'text-slate-50' : 'text-foreground',
          )}>
            FlowX
          </div>
          <div className={cn(
            'mt-[5px] font-semibold uppercase tracking-[0.08em] whitespace-nowrap',
            s.tagline,
            theme === 'dark' ? 'text-slate-300/72' : 'text-muted-foreground',
          )}>
            AI Delivery Workspace
          </div>
        </div>
      ) : null}
    </div>
  );
}
