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

  it('deduplicates concurrent identical get requests', async () => {
    const payload = [{ id: 'workspace-1' }];
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: async () => payload,
            });
          }, 0);
        }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const [first, second, third] = await Promise.all([
      api.getWorkspaces(),
      api.getWorkspaces(),
      api.getWorkspaces(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(payload);
    expect(second).toEqual(payload);
    expect(third).toEqual(payload);
  });

  it('passes runType when listing workflow runs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    vi.stubGlobal('fetch', fetchMock);

    await api.getWorkflowRuns({ runType: 'BUG_FIX' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/workflow-runs?runType=BUG_FIX',
      expect.any(Object),
    );
  });

  it('calls cursor credential endpoint for updates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ provider: 'cursor', configured: true }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await api.upsertCursorCredential({ apiKey: 'cursor-user-api-key' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/auth/ai-credentials/cursor',
      expect.objectContaining({
        method: 'PUT',
      }),
    );
  });

  it('calls codex credential endpoint for updates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ provider: 'codex', configured: true }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await api.upsertCodexCredential({ apiKey: 'openai-user-api-key' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/auth/ai-credentials/codex',
      expect.objectContaining({
        method: 'PUT',
      }),
    );
  });

  it('calls briefing endpoints with expected methods and payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    vi.stubGlobal('fetch', fetchMock);

    await api.getBriefingSources({ workspaceId: 'workspace-1' });
    await api.resolveBriefingRepositoryBinding({
      workspaceId: 'workspace-1',
      repositoryId: 'repo-1',
    });
    await api.createBriefingSource({
      workspaceId: 'workspace-1',
      repositoryId: 'repo-1',
    });
    await api.updateBriefingSource('source-1', { isActive: false });
    await api.deleteBriefingSource('source-1');
    await api.getProjectBriefingConfig('project-1');
    await api.updateProjectBriefingConfig('project-1', { enabled: true, dailyHour: 9 });
    await api.getProjectBriefings('project-1');
    await api.generateProjectBriefing('project-1', { date: '2026-06-03' });
    await api.getBriefing('briefing-1');
    await api.sendBriefing('briefing-1');
    await api.getDeliveryTargets({ workspaceId: 'workspace-1' });
    await api.createDeliveryTarget({
      workspaceId: 'workspace-1',
      type: 'EMAIL',
      name: 'Team',
      emailAddress: 'team@example.com',
    });
    await api.updateDeliveryTarget('target-1', { isActive: false });
    await api.deleteDeliveryTarget('target-1');

    expect(fetchMock.mock.calls.map((call) => [call[0], call[1]?.method ?? 'GET'])).toEqual([
      ['http://localhost:3000/briefing-sources?workspaceId=workspace-1', 'GET'],
      [
        'http://localhost:3000/briefing-sources/repository-binding?workspaceId=workspace-1&repositoryId=repo-1',
        'GET',
      ],
      ['http://localhost:3000/briefing-sources', 'POST'],
      ['http://localhost:3000/briefing-sources/source-1', 'PATCH'],
      ['http://localhost:3000/briefing-sources/source-1', 'DELETE'],
      ['http://localhost:3000/projects/project-1/briefing-config', 'GET'],
      ['http://localhost:3000/projects/project-1/briefing-config', 'PUT'],
      ['http://localhost:3000/projects/project-1/briefings', 'GET'],
      ['http://localhost:3000/projects/project-1/briefings/generate', 'POST'],
      ['http://localhost:3000/briefings/briefing-1', 'GET'],
      ['http://localhost:3000/briefings/briefing-1/send', 'POST'],
      ['http://localhost:3000/delivery-targets?workspaceId=workspace-1', 'GET'],
      ['http://localhost:3000/delivery-targets', 'POST'],
      ['http://localhost:3000/delivery-targets/target-1', 'PATCH'],
      ['http://localhost:3000/delivery-targets/target-1', 'DELETE'],
    ]);
  });
});
