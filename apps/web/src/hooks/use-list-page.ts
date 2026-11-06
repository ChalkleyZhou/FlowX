import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ListQuery } from '../api';
import type { PageResult } from '../types';

const emptyPage = <T,>(): PageResult<T> => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });

/** 保留 URL 页码；筛选变化、晚到请求和删除末页在同一处处理。 */
export function useListPage<T>(loadPage: (query: ListQuery) => Promise<PageResult<T>>, filters: ListQuery = {}, options: { enabled?: boolean; pageKey?: string } = {}) {
  const [params, setParams] = useSearchParams();
  const key = options.pageKey ?? 'page';
  const enabled = options.enabled ?? true;
  const [search,setSearch] = useState(filters.q);
  useEffect(() => {const timer = window.setTimeout(() => setSearch(filters.q),250);return () => window.clearTimeout(timer);},[filters.q]);
  const filterKey = JSON.stringify({...filters,q:search});
  const previousFilters = useRef(filterKey);
  const filterChanged = previousFilters.current !== filterKey;
  const rawPage = Number(params.get(key) ?? 1);
  const page = filterChanged ? 1 : Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const [result, setResult] = useState<PageResult<T>>(emptyPage);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const load = useRef(loadPage); load.current = loadPage;
  const onPageChange = useCallback((next: number) => {
    setParams(current => {
      const updated = new URLSearchParams(current);
      if (next > 1) updated.set(key, String(next)); else updated.delete(key);
      return updated;
    }, { replace: true });
  }, [key, setParams]);

  useEffect(() => {
    if (previousFilters.current !== filterKey) {
      previousFilters.current = filterKey;
      onPageChange(1);
    }
  }, [filterKey, onPageChange]);

  useEffect(() => {
    const version = ++epoch.current;
    if (!enabled) { setResult(emptyPage()); setLoading(false); return; }
    setLoading(true); setError('');
    void load.current({ ...JSON.parse(filterKey) as ListQuery, page, pageSize: 20 }).then(next => {
      if (version !== epoch.current) return;
      if (next.page > next.totalPages) { onPageChange(next.totalPages); return; }
      setResult(next);
    }).catch(reason => { if (version === epoch.current) setError(reason instanceof Error ? reason.message : '加载列表失败'); })
      .finally(() => { if (version === epoch.current) setLoading(false); });
    return () => { ++epoch.current; };
  }, [enabled, filterKey, page, revision, onPageChange]);

  const refresh = useCallback(() => { setRevision(value => value + 1); }, []);
  return { ...result, page, loading, error, refresh, onPageChange };
}
