import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../api';
import type { TestDesignCandidate, TestRequest } from '../../types';
import { Button } from '../../components/ui/button';
import { PagedSelect } from '../../components/PagedSelect';

export function QualityScopeCaseDetails({ request, item, previous, next, onNavigate, onClose, onSaved, onBusyChange, disabled }: {
  request: TestRequest; item: TestDesignCandidate; previous?: TestDesignCandidate; next?: TestDesignCandidate;
  onNavigate: (item: TestDesignCandidate) => void; onClose: () => void; onSaved: () => Promise<void>; onBusyChange: (busy: boolean) => void; disabled: boolean;
}) {
  const [libraryId, setLibraryId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose, saving]);
  async function save() {
    if (!libraryId) return;
    setSaving(true); onBusyChange(true); setError('');
    try {
      await api.saveGeneratedTestRequestCase(request.id, item.id, { libraryId, ...(moduleId ? { moduleId } : {}) });
      setSaved(true);
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setSaving(false); onBusyChange(false); }
  }
  const detail = item.proposedCase;
  return <aside role="region" aria-label="用例详情" className="min-w-0 rounded-md border bg-muted/10 p-4 xl:col-start-3 xl:row-start-1">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">用例详情</span>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="关闭用例详情" disabled={saving} onClick={onClose}><X className="h-4 w-4" /></Button>
    </div>
    <h3 className="mt-2 break-words font-semibold">{detail.title}</h3>
    <p className="mt-1 text-xs text-muted-foreground">{item.sourceDefinition?.library?.name ?? 'AI 新用例'}{item.sourceDefinition?.module?.name ? ` / ${item.sourceDefinition.module.name}` : ''} · {detail.priority}</p>
    <div className="mt-4 max-h-[420px] space-y-4 overflow-y-auto text-sm">
      {detail.precondition ? <div><h4 className="font-medium">前置条件</h4><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{detail.precondition}</p></div> : null}
      {detail.testData ? <div><h4 className="font-medium">测试数据</h4><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{detail.testData}</p></div> : null}
      <div><h4 className="font-medium">测试步骤</h4><ol className="mt-1 list-decimal space-y-1 pl-5">{detail.steps.map((step, index) => <li key={index} className="whitespace-pre-wrap">{step}</li>)}</ol></div>
      <div><h4 className="font-medium">预期结果</h4><p className="mt-1 whitespace-pre-wrap">{detail.expected}</p></div>
    </div>
    {item.action === 'CREATE' && !item.sourceDefinitionId && !saved ? <div className="mt-5 space-y-2 border-t pt-4">
      <p className="text-xs text-muted-foreground">需要长期复用时，可手动保存到用例库。</p>
      <PagedSelect label="保存目标用例库" placeholder="选择用例库" value={libraryId} disabled={saving || disabled} onValueChange={value => { setLibraryId(value); setModuleId(''); }} loadPage={query => api.getTestCaseLibraries({ ...query, workspaceId: request.workspaceId, projectId: request.projectId, status: 'ACTIVE' })} />
      <PagedSelect label="保存目标用例模块" placeholder="不指定模块" value={moduleId} onValueChange={setModuleId} disabled={!libraryId || saving || disabled} scopeKey={libraryId} allowClear emptyLabel="不指定模块" loadPage={query => api.getTestCaseModules(libraryId, query)} />
      <Button type="button" variant="outline" size="sm" disabled={!libraryId || saving || disabled} onClick={() => void save()}>{saving ? '保存中…' : '保存到用例库'}</Button>
    </div> : item.action === 'CREATE' ? <p className="mt-4 text-xs text-muted-foreground">已保存到用例库</p> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
    <div className="mt-5 flex justify-between gap-2 border-t pt-3">
      <Button type="button" variant="outline" size="sm" disabled={!previous || saving} onClick={() => previous && onNavigate(previous)}>上一条</Button>
      <Button type="button" variant="outline" size="sm" disabled={!next || saving} onClick={() => next && onNavigate(next)}>下一条</Button>
    </div>
  </aside>;
}
