import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, toApiUrl } from './api';

class LocalStorageMock {
  private readonly store = new Map<string, string>();

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

describe('api helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', new LocalStorageMock());
  });

  it('builds localhost api urls by default in non-browser environments', () => {
    expect(toApiUrl('/requirements')).toBe('http://localhost:3000/requirements');
    expect(toApiUrl('workflow-runs')).toBe('http://localhost:3000/workflow-runs');
  });

  it('sends bearer token when local auth token exists', async () => {
    localStorage.setItem('flowx-auth-token', 'test-token');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'workflow-1' }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await api.getWorkflowRun('workflow-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:3000/workflow-runs/workflow-1');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    });
  });

  it('surfaces parsed api error messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ message: ['first problem', 'second problem'] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(api.getRequirements()).rejects.toThrow('first problem；second problem');
  });
});
