// @vitest-environment jsdom
import { act, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProtectedLayout, ProtectedRoute } from './ProtectedRoute';
vi.mock('../auth', () => ({ useAuth: () => ({ session: null, loading: false }) }));
vi.mock('../components/AppLayout', () => ({ AppLayout: ({ children }: PropsWithChildren) => children }));
function LoginTarget() {
  const location = useLocation();
  return <div>{(location.state as { from: string })?.from}</div>;
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });
it.each(['layout', 'route'])('登录保护 %s 保留原目标的查询和片段', async (mode) => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/workflow-runs/w1?tab=execution#evidence']}><Routes>
    <Route path="/login" element={<LoginTarget />} />
    {mode === 'layout' ? <Route element={<ProtectedLayout />}><Route path="/workflow-runs/:id" element={<div>workflow</div>} /></Route>
      : <Route path="/workflow-runs/:id" element={<ProtectedRoute><div>workflow</div></ProtectedRoute>} />}
  </Routes></MemoryRouter>));
  expect(container.textContent).toBe('/workflow-runs/w1?tab=execution#evidence');
});
