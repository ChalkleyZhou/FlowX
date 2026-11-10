import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, Library } from 'lucide-react';
import { api } from '../../api';
import type { PageResult, TestCaseLibrary, TestCaseModule, TestRequest } from '../../types';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';

export type ScopeDirectorySelection = { libraryId?: string; moduleId?: string; label: string };

/** 每层独立分页，展开才读取；目录只负责定位，不改变提测范围。 */
function DirectoryLevel({ request, libraryId, parentId, selection, onSelect }: {
  request: TestRequest; libraryId?: string; parentId?: string; selection: ScopeDirectorySelection;
  onSelect: (selection: ScopeDirectorySelection) => void;
}) {
  const [items, setItems] = useState<Array<TestCaseLibrary | TestCaseModule>>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const load: Promise<PageResult<TestCaseLibrary | TestCaseModule>> = libraryId
      ? api.getTestCaseModules(libraryId, { parentId: parentId ?? 'null', page, pageSize: 20 })
      : api.getTestCaseLibraries({ workspaceId: request.workspaceId, projectId: request.projectId, status: 'ACTIVE', page, pageSize: 20 });
    void load.then(result => {
      if (!active) return;
      setItems(previous => page === 1 ? result.items : [...previous, ...result.items.filter(item => !previous.some(old => old.id === item.id))]);
      setPages(result.totalPages);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '加载目录失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request.workspaceId, request.projectId, libraryId, parentId, page, retry]);
  return <div className="space-y-1">
    {items.map(item => {
      const open = expanded.includes(item.id);
      const label = libraryId ? '模块' : '用例库';
      const selected = libraryId ? selection.moduleId === item.id : selection.libraryId === item.id && !selection.moduleId;
      return <div key={item.id}>
        <div className={cn('flex items-center rounded hover:bg-muted/60', selected && 'bg-primary/10 text-primary')}>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`${open ? '收起' : '展开'}${label} ${item.name}`} aria-expanded={open} onClick={() => setExpanded(ids => open ? ids.filter(id => id !== item.id) : [...ids, item.id])}>
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
          {libraryId ? <Folder className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Library className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <button type="button" className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm" aria-label={`筛选${label} ${item.name}`} aria-current={selected ? 'true' : undefined} onClick={() => onSelect({ libraryId: libraryId ?? item.id, moduleId: libraryId ? item.id : undefined, label: item.name })}>{item.name}</button>
        </div>
        {open ? <div className="ml-3 border-l pl-1"><DirectoryLevel request={request} libraryId={libraryId ?? item.id} parentId={libraryId ? item.id : undefined} selection={selection} onSelect={onSelect} /></div> : null}
      </div>;
    })}
    {loading ? <p role="status" className="p-2 text-xs text-muted-foreground">目录加载中…</p> : null}
    {error ? <p role="alert" className="p-2 text-xs text-destructive">{error}<Button type="button" variant="ghost" size="sm" onClick={() => setRetry(n => n + 1)}>重试</Button></p> : null}
    {!loading && !error && !items.length ? <p className="p-2 text-xs text-muted-foreground">{libraryId ? '暂无子模块' : '暂无用例库'}</p> : null}
    {page < pages ? <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => setPage(n => n + 1)}>加载更多{libraryId ? '模块' : '用例库'}</Button> : null}
  </div>;
}

export function QualityScopeDirectory({ request, selection, onSelect }: {
  request: TestRequest; selection: ScopeDirectorySelection; onSelect: (selection: ScopeDirectorySelection) => void;
}) {
  return <aside aria-label="用例目录" className="min-w-0 rounded-md border p-3">
    <h3 className="mb-2 px-2 text-sm font-medium text-muted-foreground">用例目录</h3>
    <button type="button" className={cn('mb-1 w-full rounded px-2 py-2 text-left text-sm hover:bg-muted/60', !selection.libraryId && 'bg-primary/10 font-medium text-primary')} aria-current={!selection.libraryId ? 'true' : undefined} onClick={() => onSelect({ label: '全部目录' })}>全部目录</button>
    <div className="max-h-[480px] overflow-y-auto"><DirectoryLevel request={request} selection={selection} onSelect={onSelect} /></div>
  </aside>;
}
