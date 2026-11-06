import { useEffect, useRef, useState } from 'react';
import type { PageQuery, PageResult } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

type Option = { id: string; name: string };

/** 搜索和后续页均按用户操作读取；已选记录可通过独立详情保留名称。 */
export function PagedSelect({ value, onValueChange, loadPage, placeholder = '请选择', disabled = false,
  selectedLabel, label, allowClear = false, emptyLabel = '全部', className, scopeKey = '', id,
}: {
  value: string; onValueChange: (value: string) => void;
  loadPage: (query: Required<Pick<PageQuery, 'page' | 'pageSize'>> & Pick<PageQuery, 'q'>) => Promise<PageResult<Option>>;
  placeholder?: string; disabled?: boolean; selectedLabel?: string; label?: string;
  allowClear?: boolean; emptyLabel?: string; className?: string; scopeKey?: string; id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Option[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const load = useRef(loadPage); load.current = loadPage;
  const epoch = useRef(0);
  const [selected, setSelected] = useState<Option | null>(null);

  useEffect(() => {
    if (!open) return;
    const version = ++epoch.current;
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      void load.current({ page, pageSize: 20, q: q.trim() || undefined }).then(result => {
        if (version !== epoch.current) return;
        setItems(previous => page === 1 ? result.items : [...previous, ...result.items.filter(item => !previous.some(old => old.id === item.id))]);
        setPages(result.totalPages);
      }).catch(reason => { if (version === epoch.current) setError(reason instanceof Error ? reason.message : '加载失败'); })
        .finally(() => { if (version === epoch.current) setLoading(false); });
    }, q ? 250 : 0);
    return () => { window.clearTimeout(timer); ++epoch.current; };
  }, [open, page, q, scopeKey, retry]);

  useEffect(() => { setItems([]); setPage(1); setQ(''); setSelected(null); }, [scopeKey]);
  const currentLabel = selectedLabel || items.find(item => item.id === value)?.name || (selected?.id === value ? selected.name : '');
  return <div className={cn('relative min-w-0', className)}>
    <Button type="button" id={id} variant="outline" className="w-full justify-between font-normal" aria-label={label ?? placeholder} aria-expanded={open} disabled={disabled}
      onClick={() => { setOpen(current => !current); setPage(1); setQ(''); }}>
      <span className="truncate">{value ? currentLabel || placeholder : placeholder}</span><span aria-hidden="true">⌄</span>
    </Button>
    {open ? <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-56 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
      <Input aria-label={`${label ?? placeholder}搜索`} value={q} placeholder="搜索…" onChange={event => { setQ(event.target.value); setPage(1); }} />
      <div role="listbox" aria-label={label ?? placeholder} className="mt-2 max-h-56 overflow-y-auto">
        {allowClear ? <button type="button" role="option" aria-selected={!value} className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { onValueChange(''); setOpen(false); }}>{emptyLabel}</button> : null}
        {items.map(item => <button type="button" key={item.id} role="option" aria-selected={value === item.id} className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { setSelected(item); onValueChange(item.id); setOpen(false); }}>{item.name}</button>)}
      </div>
      {loading ? <p role="status" className="p-2 text-sm text-muted-foreground">加载中…</p> : null}
      {error ? <div role="alert" className="p-2 text-sm text-destructive">{error}<Button type="button" size="sm" variant="ghost" onClick={() => setRetry(n => n + 1)}>重试</Button></div> : null}
      {!loading && !error && items.length === 0 ? <p className="p-2 text-sm text-muted-foreground">没有匹配记录</p> : null}
      {page < pages ? <Button type="button" size="sm" variant="ghost" className="w-full" disabled={loading} onClick={() => setPage(n => n + 1)}>加载更多</Button> : null}
      <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => setOpen(false)}>关闭</Button>
    </div> : null}
  </div>;
}
