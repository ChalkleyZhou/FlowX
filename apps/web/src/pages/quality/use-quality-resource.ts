import { useCallback, useEffect, useRef, useState } from 'react';

/** 区分首屏、主动刷新与后台轮询，并隔离路由切换后的迟到响应。 */
export function useQualityResource<T>(
  id: string,
  fetcher: (id: string) => Promise<T>,
  poll?: (value: T) => boolean,
  intervalMs = 5000,
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(false);
  const sequence = useRef(0);
  const pending = useRef(false);
  const retained = useRef(false);
  const reload = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!active.current || pending.current) return;
      const current = ++sequence.current;
      pending.current = true;
      if (!silent) {
        setRefreshing(true);
        setError(null);
        if (!retained.current) setLoading(true);
      }
      try {
        const value = await fetcher(id);
        if (active.current && sequence.current === current) {
          setData(value);
          retained.current = true;
          setError(null);
        }
      } catch (cause) {
        if (active.current && sequence.current === current && !silent)
          setError(cause instanceof Error ? cause : new Error('加载失败'));
      } finally {
        if (active.current && sequence.current === current) {
          pending.current = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [id, fetcher],
  );
  useEffect(() => {
    active.current = true;
    pending.current = false;
    retained.current = false;
    setData(undefined);
    setLoading(true);
    void reload();
    return () => {
      active.current = false;
      sequence.current += 1;
    };
  }, [reload]);
  const polling = data !== undefined && Boolean(poll?.(data));
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => void reload({ silent: true }), intervalMs);
    return () => window.clearInterval(timer);
  }, [polling, reload, intervalMs]);
  return { data, error, loading, refreshing, reload, setData };
}
