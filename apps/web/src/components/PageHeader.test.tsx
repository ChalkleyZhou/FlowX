// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

it('有无操作按钮时标题都占用同一行高', async () => {
  await act(async () => {
    root.render(<PageHeader title="需求" />);
  });
  const plain = container.querySelector('h1');
  expect(plain?.textContent).toBe('需求');
  expect(plain?.className).toContain('min-h-10');

  await act(async () => {
    root.render(<PageHeader title="缺陷中心" actions={<button type="button">新建缺陷</button>} />);
  });
  const withActions = container.querySelector('h1');
  expect(withActions?.className).toContain('min-h-10');
  expect(container.querySelector('h1 + div')?.className).toContain('min-h-10');
});
