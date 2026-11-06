// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { PagedSelect } from './PagedSelect';

it('打开后只取第一页，用户请求后才加载下一页且选中项能在页外显示', async () => {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  const load = vi.fn(async ({ page }: { page: number; pageSize: number; q?: string }) => ({
    items: [{ id: `p${page}`, name: `项目${page}` }], page, pageSize: 20, total: 21, totalPages: 2,
  }));
  await act(async () => root.render(<PagedSelect value="outside" selectedLabel="已有项目" onValueChange={() => {}} loadPage={load} label="选择项目" />));
  expect(element.textContent).toContain('已有项目');
  expect(load).not.toHaveBeenCalled();
  await act(async () => { element.querySelector('button')!.click(); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, q: undefined });
  await act(async () => { (Array.from(element.querySelectorAll('button')).find(b => b.textContent === '加载更多') as HTMLButtonElement).click(); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(load).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, q: undefined });
  expect(element.textContent).toContain('项目1'); expect(element.textContent).toContain('项目2');
  await act(async () => root.unmount()); element.remove();
});
