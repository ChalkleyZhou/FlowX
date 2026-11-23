import type { ProjectLabelColor, ProjectLabelSummary } from '../types';
import { cn } from '../lib/utils';

export const projectLabelColorClasses: Record<ProjectLabelColor, string> = {
  GRAY: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
  BLUE: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200',
  CYAN: 'border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950 dark:text-cyan-200',
  GREEN: 'border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200',
  AMBER: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
  ORANGE: 'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-200',
  RED: 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200',
  PURPLE: 'border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-200',
};
export function ProjectLabelBadge({ label }: { label: ProjectLabelSummary }) {
  return <span title={label.name} className={cn('inline-block max-w-40 truncate rounded border px-2 py-0.5 text-xs font-medium align-middle', projectLabelColorClasses[label.color] ?? projectLabelColorClasses.BLUE)}>{label.name}</span>;
}
export function ProjectLabelBadges({ labels, limit = 2 }: { labels?: ProjectLabelSummary[]; limit?: number }) {
  if (!labels?.length) return <span className="text-muted-foreground">—</span>;
  return <span className="inline-flex flex-wrap items-center gap-1">{labels.slice(0, limit).map(label => <ProjectLabelBadge key={label.id} label={label} />)}{labels.length > limit ? <span tabIndex={0} title={labels.map(label => label.name).join('、')} aria-label={`全部标签：${labels.map(label => label.name).join('、')}`} className="rounded border px-1.5 py-0.5 text-xs">+{labels.length - limit}</span> : null}</span>;
}
