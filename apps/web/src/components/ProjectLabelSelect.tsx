import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ProjectLabelSummary } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { PROJECT_LABEL_SELECT_DISMISS_EVENT } from './ui/dialog';
import { ProjectLabelBadge, ProjectLabelBadges } from './ProjectLabelBadges';

/** 摘要随草稿保存，分页或请求失败不能覆盖已选标签。 */
export function ProjectLabelSelect({ projectId, value, onChange, disabled = false, label = '标签（可选）' }: {
  projectId: string; value: ProjectLabelSummary[]; onChange: (value: ProjectLabelSummary[]) => void; disabled?: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [items, setItems] = useState<ProjectLabelSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const previousProject = useRef(projectId);
  const epoch = useRef(0);
  const change = useRef(onChange); change.current = onChange;

  useEffect(() => {
    if (previousProject.current === projectId) return;
    previousProject.current = projectId; ++epoch.current;
    setItems([]); setQ(''); setPage(1); setOpen(false); setError('');
    change.current([]); setNotice('已切换项目，请重新选择标签');
  }, [projectId]);
  useEffect(() => {
    if (!open || !projectId) return;
    const version = ++epoch.current; setLoading(true); setError('');
    void api.listProjectLabels(projectId, { page, pageSize: 20, q: q.trim() || undefined }).then(result => {
      if (version !== epoch.current) return;
      setItems(result.items); setPages(result.totalPages);
    }).catch(cause => { if (version === epoch.current) setError(cause instanceof Error ? cause.message : '加载标签失败'); })
      .finally(() => { if (version === epoch.current) setLoading(false); });
    return () => { ++epoch.current; };
  }, [open, projectId, page, q, retry]);
  useEffect(() => {
    if (!open) return;
    const element = root.current;
    const dismiss = () => {
      setOpen(false);
      element?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.focus();
    };
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        dismiss();
      }
    };
    element?.addEventListener(PROJECT_LABEL_SELECT_DISMISS_EVENT, dismiss);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape, true);
    return () => {
      element?.removeEventListener(PROJECT_LABEL_SELECT_DISMISS_EVENT, dismiss);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  function toggle(item: ProjectLabelSummary) {
    if (value.some(x => x.id === item.id)) { onChange(value.filter(x => x.id !== item.id)); return; }
    if (value.length >= 20) { setError('每个工作项最多选择 20 个标签'); return; }
    onChange([...value, item]);
  }
  return <div ref={root} data-project-label-panel={open ? 'open' : undefined} className="relative min-w-48">
    <Button type="button" variant="outline" className="h-auto min-h-10 w-full justify-start" aria-label={label} aria-expanded={open} aria-haspopup="dialog" disabled={disabled || !projectId} onClick={() => setOpen(x => !x)}>{value.length ? <><ProjectLabelBadges labels={value} /><span className="ml-auto text-xs">已选 {value.length}</span></> : <span>{label}</span>}</Button>
    {notice ? <p role="status" className="mt-1 text-xs text-muted-foreground">{notice}</p> : null}
    {open ? <div role="dialog" aria-label="选择项目标签" className="absolute left-0 top-full z-50 mt-1 w-full min-w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-lg">
      <Input aria-label="搜索标签" placeholder="搜索标签" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); root.current?.querySelector<HTMLButtonElement>('[role="checkbox"]')?.focus(); } }} />
      {value.length ? <div className="my-2 flex flex-wrap gap-1" aria-label="已选标签">{value.map(item => <button type="button" key={item.id} aria-label={`移除标签 ${item.name}`} onClick={() => toggle(item)}><ProjectLabelBadge label={item} /><span aria-hidden> ×</span></button>)}<Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>清空全部</Button></div> : null}
      <div className="my-2 max-h-56 overflow-y-auto" role="group" aria-label="可选标签">
        {!loading && !error ? items.map(item => <button key={item.id} type="button" role="checkbox" aria-checked={value.some(x => x.id === item.id)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent focus:bg-accent focus:outline-none" onClick={() => toggle(item)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const target = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling; if (target instanceof HTMLElement) target.focus(); } }}><span aria-hidden>{value.some(x => x.id === item.id) ? '☑' : '☐'}</span><ProjectLabelBadge label={item} /></button>) : null}
        {loading ? <p role="status" className="py-3 text-sm">加载中…</p> : null}
        {error ? <p role="alert" className="py-2 text-sm text-destructive">{error}<button type="button" className="ml-2 underline" onClick={() => setRetry(x => x + 1)}>重试</button></p> : null}
        {!loading && !error && !items.length ? <p className="py-3 text-sm text-muted-foreground">{q.trim() ? '没有匹配的标签' : '此项目暂无标签，可前往项目设置创建'}</p> : null}
      </div>
      {pages > 1 ? <div className="mb-2 flex items-center justify-between text-xs"><Button type="button" size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage(x => x - 1)}>上一页</Button><span>{page} / {pages}</span><Button type="button" size="sm" variant="outline" disabled={loading || page >= pages} onClick={() => setPage(x => x + 1)}>下一页</Button></div> : null}
      <div className="flex justify-between border-t pt-2 text-xs"><a className="text-primary underline" href={`/project-settings?projectId=${encodeURIComponent(projectId)}&tab=labels`} target="_blank" rel="noopener noreferrer">管理标签 ↗</a><button type="button" className="text-primary underline" onClick={() => setRetry(x => x + 1)}>刷新标签</button></div>
    </div> : null}
  </div>;
}
