import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';

export const requestStatusLabels: Record<string, string> = {
  DRAFT: '范围生成中',
  READY: '待执行',
  IN_TEST: '执行中',
  PASSED: '已通过',
  FAILED: '未通过',
  BLOCKED: '已阻塞',
  CANCELLED: '已取消',
};

export const runStatusLabels: Record<string, string> = {
  ACTIVE: '执行中',
  PASSED: '已通过',
  FAILED: '未通过',
  BLOCKED: '已阻塞',
};

export function statusBadgeVariant(status: string) {
  if (status === 'PASSED') return 'success' as const;
  if (status === 'FAILED') return 'destructive' as const;
  if (status === 'BLOCKED') return 'warning' as const;
  return 'secondary' as const;
}

export function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      title="刷新"
      aria-label="刷新"
      disabled={loading}
      onClick={onClick}
    >
      <RefreshCw aria-hidden="true" className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
    </Button>
  );
}

export function LoadingState() {
  return (
    <div className="flex min-h-48 items-center justify-center" aria-label="加载中">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <span className="text-sm text-muted-foreground">共 {total} 条</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          上一页
        </Button>
        <span className="min-w-20 text-center text-sm text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          下一页
        </Button>
      </div>
    </div>
  );
}

export function formatDate(value?: string | null) {
  if (!value) return '尚未开始';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
