/** Maps API gantt bar color tokens to Tailwind classes (design-system semantic). */

const BAR_COLOR_CLASS: Record<string, string> = {
  aggregate: 'bg-muted-foreground/35 text-foreground border border-border',
  'role-pm': 'bg-primary text-primary-foreground',
  'role-frontend': 'bg-primary/80 text-primary-foreground',
  'role-backend': 'bg-success text-primary-foreground',
  'role-fullstack': 'bg-warning text-foreground',
  'role-qa': 'bg-muted-foreground/80 text-primary-foreground',
  'role-design': 'bg-primary-soft text-foreground border border-primary/30',
  'role-other': 'bg-muted text-foreground',
};

export function ganttBarColorClass(color?: string): string {
  if (!color) {
    return BAR_COLOR_CLASS['role-other'];
  }
  return BAR_COLOR_CLASS[color] ?? BAR_COLOR_CLASS['role-other'];
}
