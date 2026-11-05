import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { PROJECT_DEPENDENT_QUERY_KEYS, isProjectScopedListPath, readCurrentProjectId } from '../project-scope';

const STORAGE_PREFIX = 'flowx-list-filters:';
const DEPENDENT_FILTER_KEYS = new Set<string>(PROJECT_DEPENDENT_QUERY_KEYS);

type ListFilterSnapshot = {
  projectId: string | null;
  filters: Record<string, string>;
};

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const filters: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item) {
      filters[key] = item;
    }
  }
  return filters;
}

export function readStoredListFilterSnapshot(pageKey: string): ListFilterSnapshot {
  if (typeof window === 'undefined') {
    return { projectId: null, filters: {} };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + pageKey);
    if (!raw) {
      return { projectId: null, filters: {} };
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { projectId: null, filters: {} };
    }
    const record = parsed as Record<string, unknown>;
    if (record.filters && typeof record.filters === 'object' && !Array.isArray(record.filters)) {
      return {
        projectId: typeof record.projectId === 'string' && record.projectId ? record.projectId : null,
        filters: stringRecord(record.filters),
      };
    }
    return { projectId: null, filters: stringRecord(record) };
  } catch {
    return { projectId: null, filters: {} };
  }
}

/** 同一项目恢复全部筛选项。换项目或旧记录没有项目归属时，只保留状态、优先级、关键词这类不依赖项目的条件。 */
export function filtersForCurrentProject(stored: ListFilterSnapshot, currentProjectId: string | null) {
  const sameProject = Boolean(stored.projectId && currentProjectId && stored.projectId === currentProjectId);
  const unscoped = !stored.projectId && !currentProjectId;
  if (sameProject || unscoped) {
    return stored.filters;
  }
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored.filters)) {
    if (!DEPENDENT_FILTER_KEYS.has(key)) {
      filters[key] = value;
    }
  }
  return filters;
}

export function readStoredListFilters(pageKey: string): Record<string, string> {
  return readStoredListFilterSnapshot(pageKey).filters;
}

export function writeStoredListFilterSnapshot(pageKey: string, snapshot: ListFilterSnapshot) {
  if (typeof window === 'undefined') {
    return;
  }
  const filters = stringRecord(snapshot.filters);
  const payload: { projectId?: string; filters: Record<string, string> } = { filters };
  if (snapshot.projectId) {
    payload.projectId = snapshot.projectId;
  }
  window.localStorage.setItem(STORAGE_PREFIX + pageKey, JSON.stringify(payload));
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
  const location = useLocation();
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
      const currentProjectId = searchParams.get('projectId') || readCurrentProjectId();
      const stored = filtersForCurrentProject(readStoredListFilterSnapshot(pageKey), currentProjectId);
      for (const key of filterKeys) {
        if (stored[key]) next.set(key, stored[key]);
      }
    }
    if (fillRef.current) next = fillRef.current(next);
    const rememberedProjectId = searchParams.get('projectId') || readCurrentProjectId();
    if (rememberedProjectId && isProjectScopedListPath(location.pathname) && !next.get('projectId')) {
      next.set('projectId', rememberedProjectId);
    }
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
    writeStoredListFilterSnapshot(pageKey, {
      projectId: searchParams.get('projectId') || readCurrentProjectId(),
      filters: snapshot,
    });
  }, [pageKey, searchParams]);
}
