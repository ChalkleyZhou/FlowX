import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type UIEvent, type WheelEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { PageQuery, PageResult } from '../types';
import { cn } from '../lib/utils';

type Option = { id: string; name: string };

const triggerClass = 'flex h-10 w-full items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring/40';

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
  const [activeIndex, setActiveIndex] = useState(0);
  const load = useRef(loadPage); load.current = loadPage;
  const epoch = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(1);
  const pagesRef = useRef(1);
  const loadingRef = useRef(false);
  const [selected, setSelected] = useState<Option | null>(null);
  const listId = useId();
  pageRef.current = page;
  pagesRef.current = pages;

  const choices: Option[] = [...(allowClear ? [{ id: '', name: emptyLabel }] : []), ...items];
  const currentLabel = selectedLabel || items.find(item => item.id === value)?.name || (selected?.id === value ? selected.name : '');

  useEffect(() => {
    if (!open) {
      loadingRef.current = false;
      return;
    }
    const version = ++epoch.current;
    loadingRef.current = true;
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      void load.current({ page, pageSize: 20, q: q.trim() || undefined }).then(result => {
        if (version !== epoch.current) return;
        setItems(previous => page === 1 ? result.items : [...previous, ...result.items.filter(item => !previous.some(old => old.id === item.id))]);
        setPages(result.totalPages);
      }).catch(reason => { if (version === epoch.current) setError(reason instanceof Error ? reason.message : '加载失败'); })
        .finally(() => { if (version === epoch.current) { loadingRef.current = false; setLoading(false); } });
    }, q ? 250 : 0);
    return () => { window.clearTimeout(timer); ++epoch.current; };
  }, [open, page, q, scopeKey, retry]);

  useEffect(() => { setItems([]); setPage(1); setQ(''); setSelected(null); }, [scopeKey]);
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);
  const firstPageKey = page === 1 ? items.map(item => item.id).join('\0') : '';
  useEffect(() => {
    if (!open || page !== 1) return;
    const selectedIndex = [...(allowClear ? [{ id: '' }] : []), ...items].findIndex(item => item.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, q, page, firstPageKey, allowClear, value, items]);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  function openMenu() {
    if (disabled) return;
    setQ('');
    setPage(1);
    setOpen(true);
  }

  function selectChoice(choice: Option) {
    setSelected(choice.id ? choice : null);
    onValueChange(choice.id);
    setOpen(false);
  }

  function requestNextPage() {
    if (loadingRef.current || pageRef.current >= pagesRef.current) return;
    const next = pageRef.current + 1;
    loadingRef.current = true;
    pageRef.current = next;
    setPage(next);
  }

  function onListWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.deltaY <= 0) return;
    const el = event.currentTarget;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (el.scrollHeight <= el.clientHeight + 1 || remaining <= 24) requestNextPage();
  }

  function onListScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 24) requestNextPage();
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(index + 1, Math.max(choices.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && choices[activeIndex]) {
      event.preventDefault();
      selectChoice(choices[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  return <div ref={rootRef} className={cn('relative min-w-0', className)}>
    <div className={cn(triggerClass, 'relative', disabled && 'cursor-not-allowed opacity-50')}>
      <button type="button" id={id} className="absolute inset-0 flex items-center rounded-md px-3 pr-8 text-left outline-none disabled:cursor-not-allowed" aria-label={label ?? placeholder} aria-expanded={open} aria-haspopup="listbox" disabled={disabled} onClick={() => { if (!open) openMenu(); }}>
        <span className={cn('truncate', !value && 'text-muted-foreground', open && 'invisible')}>{value ? currentLabel || placeholder : placeholder}</span>
      </button>
      {open ? <input ref={searchRef} role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list" aria-activedescendant={choices.length ? `${listId}-option-${activeIndex}` : undefined} aria-label={`${label ?? placeholder}搜索`} value={q} placeholder={value ? currentLabel || placeholder : placeholder} className="absolute inset-y-0 left-3 right-8 z-10 bg-transparent outline-none placeholder:text-muted-foreground" onChange={event => { setQ(event.target.value); setPage(1); }} onKeyDown={onSearchKeyDown} /> : null}
      <ChevronDown className={cn('relative z-10 ml-auto h-4 w-4 shrink-0 opacity-50', open && 'rotate-180')} aria-hidden="true" onMouseDown={event => { event.preventDefault(); event.stopPropagation(); if (disabled) return; if (open) setOpen(false); else openMenu(); }} />
    </div>
    {open ? <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
      <div ref={listRef} id={listId} role="listbox" aria-label={label ?? placeholder} className="max-h-64 overflow-y-auto p-1" onWheel={onListWheel} onScroll={onListScroll}>
        {choices.map((item, index) => <button type="button" key={item.id || '__empty__'} id={`${listId}-option-${index}`} role="option" aria-selected={value === item.id} data-active={index === activeIndex ? 'true' : undefined} className={cn('relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-left text-sm outline-none', index === activeIndex && 'bg-accent text-accent-foreground')} onMouseEnter={() => setActiveIndex(index)} onClick={() => selectChoice(item)}>
          <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">{value === item.id ? <Check className="h-4 w-4" /> : null}</span>
          <span className="truncate">{item.name}</span>
        </button>)}
      </div>
      {loading ? <p role="status" className="px-3 py-2 text-sm text-muted-foreground">加载中…</p> : null}
      {error ? <p role="alert" className="px-3 py-2 text-sm text-destructive">{error}<button type="button" className="ml-2 underline" onClick={() => setRetry(count => count + 1)}>重试</button></p> : null}
      {!loading && !error && items.length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">没有匹配记录</p> : null}
    </div> : null}
  </div>;
}
