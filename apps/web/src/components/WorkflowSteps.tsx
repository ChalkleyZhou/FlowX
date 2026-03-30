import { Check, Circle, Clock3, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent, CardDescription, CardTitle } from './ui/card';

type StepStatus = 'wait' | 'process' | 'finish' | 'error';

interface WorkflowStepItem {
  key: string;
  title: string;
  description?: string;
  status: StepStatus;
}

interface WorkflowStepsProps {
  current: number;
  items: WorkflowStepItem[];
  onChange?: (next: number) => void;
  className?: string;
}

function getStepIcon(status: StepStatus) {
  switch (status) {
    case 'finish':
      return <Check className="h-4 w-4" />;
    case 'process':
      return <Clock3 className="h-4 w-4" />;
    case 'error':
      return <XCircle className="h-4 w-4" />;
    default:
      return <Circle className="h-3.5 w-3.5 fill-current" />;
  }
}

export function WorkflowSteps({ current, items, onChange, className }: WorkflowStepsProps) {
  return (
    <div className={cn('grid gap-3 md:grid-cols-2 xl:grid-cols-4', className)}>
      {items.map((item, index) => {
        const isActive = index === current;
        return (
          <button
            key={item.key}
            type="button"
            className="text-left"
            onClick={() => onChange?.(index)}
          >
            <Card
              className={cn(
                'rounded-2xl border-slate-200 bg-slate-50 text-left shadow-none transition-all hover:border-slate-300 hover:bg-white',
                isActive && 'border-primary/30 bg-primary/5 shadow-sm',
                item.status === 'finish' && 'border-emerald-200/80 bg-emerald-50/70',
                item.status === 'process' && 'border-amber-200/80 bg-amber-50/70',
                item.status === 'error' && 'border-red-200/80 bg-red-50/70',
              )}
            >
              <CardContent className="flex min-w-0 items-start gap-3 p-4">
                <div className="flex shrink-0 flex-col items-center gap-2">
                  <span
                    className={cn(
                      'grid h-8 w-8 place-items-center rounded-full border bg-white text-slate-400',
                      item.status === 'finish' && 'border-emerald-200 text-emerald-600',
                      item.status === 'process' && 'border-amber-200 text-amber-600',
                      item.status === 'error' && 'border-red-200 text-red-600',
                    )}
                  >
                    {getStepIcon(item.status)}
                  </span>
                  <span className="text-[11px] font-bold tracking-[0.08em] text-slate-400">{index + 1}</span>
                </div>
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-sm leading-5">{item.title}</CardTitle>
                  <CardDescription className="break-words text-xs leading-5 text-slate-500">
                    {item.description ?? '尚未开始'}
                  </CardDescription>
                </div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
