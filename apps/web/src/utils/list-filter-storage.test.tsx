// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readStoredListFilters, useRememberedSearchFilters, useStoredListFilters, writeStoredListFilters } from './list-filter-storage';

function SearchProbe({ pageKey, keys }: { pageKey: string; keys: string[] }) {
  useRememberedSearchFilters(pageKey, keys);
  const location = useLocation();
  return <div data-search={location.search} />;
}

function ClearProbe() {
  const [, setSearchParams] = useSearchParams();
  useRememberedSearchFilters('requirements', ['projectId', 'priority']);
  return <button type="button" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>清除筛选</button>;
}

function StateProbe({ pageKey }: { pageKey: string }) {
  const [filters, setFilter] = useStoredListFilters(pageKey);
  return <button type="button" onClick={() => setFilter('status', filters.status === 'OPEN' ? undefined : 'OPEN')}>{filters.status ?? '全部'}</button>;
}

describe('列表筛选本地缓存', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('没有地址栏条件时恢复上次筛选，带条件的链接覆盖本机记录', async () => {
    writeStoredListFilters('requirements', { projectId: 'project-saved', priority: 'HIGH' });
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/requirements']}><Routes><Route path="/requirements" element={<SearchProbe pageKey="requirements" keys={['projectId', 'priority']} />} /></Routes></MemoryRouter>);
    });
    expect(container.querySelector('[data-search]')?.getAttribute('data-search')).toBe('?projectId=project-saved&priority=HIGH');

    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/requirements?projectId=project-link']}><Routes><Route path="/requirements" element={<SearchProbe pageKey="requirements" keys={['projectId', 'priority']} />} /></Routes></MemoryRouter>);
    });
    expect(container.querySelector('[data-search]')?.getAttribute('data-search')).toBe('?projectId=project-link');
    expect(readStoredListFilters('requirements')).toEqual({ projectId: 'project-link' });
  });

  it('清除筛选后刷新不再恢复旧条件', async () => {
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/requirements?projectId=project-1&priority=HIGH']}><Routes><Route path="/requirements" element={<ClearProbe />} /></Routes></MemoryRouter>);
    });
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(readStoredListFilters('requirements')).toEqual({});
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/requirements']}><Routes><Route path="/requirements" element={<SearchProbe pageKey="requirements" keys={['projectId', 'priority']} />} /></Routes></MemoryRouter>);
    });
    expect(container.querySelector('[data-search]')?.getAttribute('data-search')).toBe('');
  });

  it('页面内筛选在重新进入后保持', async () => {
    await act(async () => {
      root.render(<StateProbe pageKey="bugs" />);
    });
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('button')?.textContent).toBe('OPEN');
    await act(async () => {
      root.render(<StateProbe pageKey="bugs" />);
    });
    expect(container.querySelector('button')?.textContent).toBe('OPEN');
  });
});
