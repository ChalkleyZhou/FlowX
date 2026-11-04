// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { QualityArtifactButton } from './QualityArtifactButton';
vi.mock('../../api', () => ({ api: { fetchArtifactContent: vi.fn() } }));
vi.mock('../../components/ui/toast', () => ({ useToast: () => ({ error: vi.fn() }) }));
let root: Root;
let container: HTMLDivElement;
const revoke = vi.fn();
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(api.fetchArtifactContent).mockResolvedValue(new Blob(['evidence'], { type: 'text/plain' }));
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:evidence'), revokeObjectURL: revoke }),
  );
  revoke.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('预览关闭立即释放对象URL，iframe禁用脚本', async () => {
  await act(async () =>
    root.render(<QualityArtifactButton artifactId="artifact-1">预览证据</QualityArtifactButton>),
  );
  await act(async () => container.querySelector('button')?.click());
  expect(api.fetchArtifactContent).toHaveBeenCalledWith('artifact-1');
  expect(document.querySelector('iframe')?.getAttribute('sandbox')).toBe('');
  await act(async () =>
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Close')
      ?.click(),
  );
  expect(revoke).toHaveBeenCalledWith('blob:evidence');
});
it('下载在完成触发后释放对象URL，不等页面卸载', async () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await act(async () =>
    root.render(
      <QualityArtifactButton artifactId="artifact-1" download>
        下载
      </QualityArtifactButton>,
    ),
  );
  await act(async () => container.querySelector('button')?.click());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(revoke).toHaveBeenCalledWith('blob:evidence');
});
