// @vitest-environment jsdom
import { act, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./auth', () => ({ AuthProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('./components/theme-provider', () => ({ ThemeProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('./pages/RequirementsPage', () => ({ RequirementsPage: () => <div>requirements-page</div> }));
vi.mock('./routes/ProtectedRoute', () => ({ ProtectedLayout: () => <Outlet />, ProtectedRoute: ({ children }: PropsWithChildren) => children }));
vi.mock('./pages/ExecutionSessionsPage', () => ({
  ExecutionSessionsPage: () => { const location = useLocation(); return <div>dashboard:{location.pathname}{location.search}</div>; },
  ExecutionSessionDetailPage: () => <div>execution-detail</div>,
}));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });
async function render(path: string) {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>));
}
it('进入系统根路径默认打开看板', async () => {
  await render('/');
  expect(container.textContent).toContain('dashboard:/dashboard');
});
it('旧运行列表链接转到看板并保留筛选和页码', async () => {
  await render('/execution-sessions?projectId=p1&view=attention&page=2');
  expect(container.textContent).toContain('dashboard:/dashboard?projectId=p1&view=attention&page=2');
});
it('保留运行详情的原有直接链接', async () => {
  await render('/execution-sessions/s1');
  expect(container.textContent).toContain('execution-detail');
});
