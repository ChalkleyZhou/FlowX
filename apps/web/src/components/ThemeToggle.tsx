import { useTheme } from './theme-provider';

const themes = ['light', 'dark', 'system'] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  function cycleTheme() {
    const idx = themes.indexOf(theme);
    const next = themes[(idx + 1) % themes.length];
    setTheme(next);
  }

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center gap-3 min-h-[46px] w-full px-3.5 py-2.5 rounded-md text-secondary-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`当前: ${theme === 'light' ? '亮色' : theme === 'dark' ? '暗色' : '跟随系统'} — 点击切换`}
    >
      {theme === 'light' ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : theme === 'dark' ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      )}
      <span className="text-sm">
        {theme === 'light' ? '亮色' : theme === 'dark' ? '暗色' : '跟随系统'}
      </span>
    </button>
  );
}
