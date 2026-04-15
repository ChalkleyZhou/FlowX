import { useTheme } from './theme-provider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const THEME_LABELS = {
  light: '亮色',
  dark: '暗色',
  system: '跟随系统',
} as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="rounded-md border border-transparent px-1">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">主题</div>
      <Select value={theme} onValueChange={(value) => setTheme(value as 'light' | 'dark' | 'system')}>
        <SelectTrigger className="h-[34px] border-border bg-surface px-2.5 text-sm text-foreground focus:ring-ring/30">
          <SelectValue>{THEME_LABELS[theme]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">{THEME_LABELS.light}</SelectItem>
          <SelectItem value="dark">{THEME_LABELS.dark}</SelectItem>
          <SelectItem value="system">{THEME_LABELS.system}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
