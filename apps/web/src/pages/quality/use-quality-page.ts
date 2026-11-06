import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageResult } from '../../types';

/** 保留已渲染的页，忽略过期响应，后台刷新不切换首屏加载状态。 */
export function useQualityPage<T>(key: string, loader: () => Promise<PageResult<T>>, enabled = true, onPageChange?: (page: number) => void) {
  const [data, setData] = useState<PageResult<T>>({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const pageChangeRef = useRef(onPageChange);
  pageChangeRef.current = onPageChange;
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const sequence = useRef(0);
  const loaded = useRef(false);
  const inFlight = useRef(false);
  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!enabled || (options?.silent && inFlight.current)) return;
    const token = ++sequence.current;
    inFlight.current = true;
    if (!loaded.current && !options?.silent) setLoading(true);
    setRefreshing(true);
    try {
      const next = await loaderRef.current();
      if (token !== sequence.current) return;
      const lastPage = Math.max(1, next.totalPages);
      if (next.page > lastPage && pageChangeRef.current) {
        pageChangeRef.current(lastPage);
        return;
      }
      setData(next);
      loaded.current = true;
      setError('');
    } catch (cause) {
      if (token === sequence.current && !options?.silent) setError(cause instanceof Error ? cause.message : '加载列表失败');
    } finally {
      if (token === sequence.current) {
        inFlight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [enabled, key]);
  useEffect(() => {
    if (enabled) void refresh();
    else { setData({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }); setLoading(false); }
    return () => { sequence.current += 1; inFlight.current = false; };
  }, [refresh, enabled]);
  return { ...data, hasLoaded: loaded.current, loading, refreshing, error, refresh, setData };
}
