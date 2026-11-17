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
    items: [{ id: `p${page}`, name: `项目${page}` }], page, pageSize: 20, total: 41, totalPages: 3,
  }));
  await act(async () => root.render(<PagedSelect value="outside" selectedLabel="已有项目" onValueChange={() => {}} loadPage={load} label="选择项目" />));
  expect(element.textContent).toContain('已有项目');
  expect(load).not.toHaveBeenCalled();
  await act(async () => { element.querySelector('button')!.click(); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, q: undefined });
  expect(element.textContent).not.toContain('加载更多');
  expect(element.textContent).not.toContain('关闭');
  const list = element.querySelector('[role="listbox"]')!;
  await act(async () => {
    list.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }));
    list.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }));
  });
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(load).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, q: undefined });
  expect(element.textContent).toContain('项目1'); expect(element.textContent).toContain('项目2');
  await act(async () => { list.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(load).toHaveBeenLastCalledWith({ page: 3, pageSize: 20, q: undefined });
  await act(async () => root.unmount()); element.remove();
});

it('未选择时展示可清空筛选项的默认文案，并保持稳定宽度', async () => {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  await act(async () => root.render(
    <PagedSelect value="" allowClear emptyLabel="全部人员" placeholder="搜索人员" onValueChange={() => {}} loadPage={async () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 })} label="按执行人筛选" />,
  ));
  const trigger = element.querySelector('[aria-label="按执行人筛选"]') as HTMLElement;
  expect(trigger.textContent).toContain('全部人员');
  expect(element.firstElementChild?.className).toContain('min-w-40');
  await act(async () => root.unmount()); element.remove();
});
