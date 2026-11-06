// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { ListPagination } from './ListPagination';

it('第二页可继续浏览且空列表禁用前后页，不渲染无限页码', async () => {
  const element = document.createElement('div');
  const root = createRoot(element);
  const change = vi.fn();
  await act(async () => root.render(<ListPagination page={2} total={100_000} onPageChange={change} />));
  expect(element.querySelectorAll('button').length).toBeLessThan(12);
  await act(async () => (Array.from(element.querySelectorAll('button')).find(b => b.textContent === '下一页') as HTMLButtonElement).click());
  expect(change).toHaveBeenCalledWith(3);
  await act(async () => root.render(<ListPagination page={1} total={0} onPageChange={change} />));
  expect(Array.from(element.querySelectorAll('button')).every(b => b.disabled)).toBe(true);
  await act(async () => root.unmount());
});
