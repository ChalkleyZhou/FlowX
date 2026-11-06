import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../../components/ui/button';
import { useQualityPage } from './use-quality-page';

export function QualityModuleTree({ libraryId, parentId = null, selectedId, onSelect, onAdd }: {
  libraryId: string; parentId?: string | null; selectedId?: string;
  onSelect: (id: string) => void; onAdd: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const modules = useQualityPage(`${libraryId}:${parentId}`, () => api.getTestCaseModules(libraryId, { parentId: parentId ?? 'null', page: 1, pageSize: 100 }));
  return <div className="space-y-1">
    {modules.error ? <p role="alert" className="text-xs">{modules.error}<Button size="sm" variant="ghost" onClick={() => void modules.refresh()}>重试</Button></p> : null}
    {modules.loading ? <p role="status" className="p-2 text-xs">加载模块...</p> : modules.items.map(module => <div key={module.id}>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label={`${expanded.includes(module.id) ? '收起' : '展开'}模块：${module.name}`} onClick={() => setExpanded(ids => ids.includes(module.id) ? ids.filter(id => id !== module.id) : [...ids, module.id])}>{expanded.includes(module.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</Button>
        <button className={`min-w-0 flex-1 truncate rounded px-1 py-1.5 text-left text-sm hover:bg-muted ${selectedId === module.id ? 'font-medium text-primary' : ''}`} aria-label={`筛选模块：${module.name}`} onClick={() => onSelect(module.id)}>{module.name}</button>
        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label={`在模块“${module.name}”下添加子模块`} onClick={() => onAdd(module.id)}><Plus className="h-3 w-3" /></Button>
      </div>
      {expanded.includes(module.id) ? <div className="ml-4"><QualityModuleTree libraryId={libraryId} parentId={module.id} selectedId={selectedId} onSelect={onSelect} onAdd={onAdd} /></div> : null}
    </div>)}
    {!modules.loading && !modules.total ? <p className="p-2 text-xs text-muted-foreground">暂无子模块</p> : null}
  </div>;
}
