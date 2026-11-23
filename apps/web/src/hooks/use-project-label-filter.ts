import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { ProjectLabelSummary } from '../types';

/** URL 是已提交条件；失效 ID 保留到用户显式移除，补全摘要不会覆盖用户草稿。 */
export function useProjectLabelFilter(projectId: string) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('labelIds') ?? '';
  const ids = [...new Set(raw.split(',').map(id => id.trim()).filter(Boolean))];
  const idKey = ids.join(',');
  const [draft, setDraftState] = useState<ProjectLabelSummary[]>(() => ids.map(id => ({ id, name: `标签 ${id}`, color: 'GRAY' })));
  const draftRef = useRef(draft);
  const [error, setError] = useState('');
  const previousProject = useRef(projectId);

  function setDraft(value: ProjectLabelSummary[]) {
    draftRef.current = value;
    setDraftState(value);
  }

  useEffect(() => {
    if (previousProject.current === projectId) return;
    previousProject.current = projectId;
    setDraft([]);
    setError('');
    setParams(current => {
      const next = new URLSearchParams(current);
      next.delete('labelIds'); next.delete('page');
      return next;
    }, { replace: true });
  }, [projectId, setParams]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    if (!ids.length) { setDraft([]); return; }
    setDraft(ids.map(id => ({ id, name: `标签 ${id}`, color: 'GRAY' })));
    if (!projectId) return;
    void (async () => {
      const found = new Map<string, ProjectLabelSummary>();
      let page = 1;
      let totalPages = 1;
      do {
        const result = await api.listProjectLabels(projectId, { page, pageSize: 100 });
        if (cancelled) return;
        for (const item of result.items) if (ids.includes(item.id)) found.set(item.id, item);
        totalPages = result.totalPages;
        page++;
      } while (page <= totalPages && found.size < ids.length);
      if (cancelled) return;
      // 只给当前草稿集合补名称，不复活请求期间已经移除的筛选。
      const current = draftRef.current;
      setDraft(current.map(label => found.get(label.id) ?? (ids.includes(label.id)
        ? { id: label.id, name: `已失效标签 ${label.id}`, color: 'GRAY' }
        : label)));
      if (current.some(label => ids.includes(label.id) && !found.has(label.id))) {
        setError('部分筛选标签已失效，请移除后重新查询');
      }
    })().catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '加载筛选标签失败'); });
    return () => { cancelled = true; };
  }, [projectId, idKey]);

  return {
    labelIds: ids,
    draft,
    setDraft,
    error,
    write: (next: URLSearchParams) => {
      if (draft.length) next.set('labelIds', draft.map(label => label.id).join(','));
      else next.delete('labelIds');
      next.delete('page');
    },
    clear: () => { setDraft([]); setError(''); },
  };
}
