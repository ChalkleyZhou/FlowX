import { Button } from './ui/button';

export function ListPagination({ page, total, pageSize = 20, loading = false, onPageChange, label = '列表分页' }: {
  page: number; total: number; pageSize?: number; loading?: boolean;
  onPageChange: (page: number) => void; label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  return <nav aria-label={label} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
    <p className="text-sm text-muted-foreground">共 {total} 条 · 每页 {pageSize} 条 · 第 {page} / {pages} 页</p>
    <div className="flex items-center gap-1">
      <Button type="button" size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>上一页</Button>
      {numbers.map((n, i) => <span className="flex items-center gap-1" key={n}>
        {i > 0 && n - numbers[i - 1] > 1 ? <span aria-hidden="true">…</span> : null}
        <Button type="button" size="sm" variant={n === page ? 'default' : 'outline'} aria-label={`第 ${n} 页`} aria-current={n === page ? 'page' : undefined} disabled={loading || total === 0} onClick={() => onPageChange(n)}>{n}</Button>
      </span>)}
      <Button type="button" size="sm" variant="outline" disabled={loading || page >= pages} onClick={() => onPageChange(page + 1)}>下一页</Button>
    </div>
  </nav>;
}
