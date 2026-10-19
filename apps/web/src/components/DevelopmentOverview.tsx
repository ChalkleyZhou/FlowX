import { Activity, CheckCircle2, CircleAlert, Layers } from 'lucide-react';
import type { ExecutionSessionView } from '../types';
import { cn } from '../lib/utils';

const metrics = [
  { key: 'active', label: '进行中', description: '等待启动与正在推进', icon: Activity, tone: 'text-primary' },
  { key: 'attention', label: '需关注', description: '阻塞、失败或回报中断', icon: CircleAlert, tone: 'text-warning' },
  { key: 'completed', label: '已完成', description: '已回传完成结果', icon: CheckCircle2, tone: 'text-success' },
  { key: 'all', label: '全部', description: '包含已取消的执行历史', icon: Layers, tone: 'text-muted-foreground' },
] as const;

export function DevelopmentOverview({ counts, view, onChange }: {
  counts: Record<ExecutionSessionView, number> | null;
  view: ExecutionSessionView;
  onChange: (view: ExecutionSessionView) => void;
}) {
  return <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="开发概览">
    {metrics.map(({ key, label, description, icon: Icon, tone }) => <button
      key={key} type="button" aria-label={label} aria-pressed={view === key} onClick={() => onChange(key)}
      className={cn('rounded-md border bg-card p-4 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:p-5',
        view === key ? 'border-primary/60 bg-primary/5' : 'border-border')}
    >
      <div className="flex items-center justify-between gap-2 text-sm font-medium"><span>{label}</span><Icon aria-hidden="true" className={cn('h-4 w-4', tone)} /></div>
      <div className="mt-3 text-3xl font-semibold tabular-nums">{counts ? counts[key].toLocaleString('zh-CN') : '—'}</div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
    </button>)}
  </section>;
}
