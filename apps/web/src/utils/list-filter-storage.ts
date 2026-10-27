import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const STORAGE_PREFIX = 'flowx-list-filters:';

export function readStoredListFilters(pageKey: string): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + pageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const filters: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value) {
        filters[key] = value;
      }
    }
    return filters;
  } catch {
    return {};
  }
}

export function writeStoredListFilters(pageKey: string, filters: Record<string, string>) {
  if (typeof window === 'undefined') {
    return;
  }
  const compact: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      compact[key] = value;
    }
  }
  window.localStorage.setItem(STORAGE_PREFIX + pageKey, JSON.stringify(compact));
}

export function useStoredListFilters(pageKey: string) {
  const [snapshot, setSnapshot] = useState(() => ({
    pageKey,
    filters: readStoredListFilters(pageKey),
  }));
  if (snapshot.pageKey !== pageKey) {
    setSnapshot({ pageKey, filters: readStoredListFilters(pageKey) });
  }

  const setFilter = useCallback((key: string, value: string | undefined) => {
    setSnapshot((current) => {
      const filters = { ...(current.pageKey === pageKey ? current.filters : readStoredListFilters(pageKey)) };
      if (value) {
        filters[key] = value;
      } else {
        delete filters[key];
      }
      writeStoredListFilters(pageKey, filters);
      return { pageKey, filters };
    });
  }, [pageKey]);

  const filters = snapshot.pageKey === pageKey ? snapshot.filters : readStoredListFilters(pageKey);
  return [filters, setFilter] as const;
}

function pickFilters(params: URLSearchParams, keys: readonly string[]) {
  const filters: Record<string, string> = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value) {
      filters[key] = value;
    }
  }
  return filters;
}

/** 地址栏没有筛选项时恢复本机记录；已有筛选项的链接优先，并写回本机。 */
export function useRememberedSearchFilters(
  pageKey: string,
  keys: readonly string[],
  fill?: (params: URLSearchParams) => URLSearchParams,
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const fillRef = useRef(fill);
  fillRef.current = fill;
  const appliedPage = useRef<string | null>(null);
  const pendingHydration = useRef(false);

  useEffect(() => {
    if (appliedPage.current === pageKey) {
      return;
    }
    appliedPage.current = pageKey;
    // 只在进入页面时恢复一次。没有变化时不写地址栏，避免多触发一次列表请求。
    const filterKeys = keysRef.current;
    let next = new URLSearchParams(searchParams);
    const hasExplicit = filterKeys.some((key) => searchParams.get(key));
    if (!hasExplicit) {
      const stored = readStoredListFilters(pageKey);
      for (const key of filterKeys) {
        if (stored[key]) next.set(key, stored[key]);
      }
    }
    if (fillRef.current) next = fillRef.current(next);
    if (next.toString() === searchParams.toString()) return;
    pendingHydration.current = true;
    setSearchParams(next, { replace: true });
  }, [pageKey, searchParams, setSearchParams]);

  useEffect(() => {
    const filterKeys = keysRef.current;
    const snapshot = pickFilters(searchParams, filterKeys);
    if (pendingHydration.current) {
      if (Object.keys(snapshot).length === 0) {
        return;
      }
      pendingHydration.current = false;
    }
    writeStoredListFilters(pageKey, snapshot);
  }, [pageKey, searchParams]);
}
