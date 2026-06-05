import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowXApiClient } from './flowx-api-client.js';

describe('FlowXApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists tasks with default base URL and bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'req-1' }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new FlowXApiClient({ token: 'token-1' });
    const tasks = await client.listTasks('workspace-1');

    expect(tasks).toEqual([{ id: 'req-1' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/cursor-local/tasks?workspaceId=workspace-1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
  });

  it('throws useful API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: 'Unauthorized' }),
      }),
    );

    const client = new FlowXApiClient({ baseUrl: 'http://flowx.local', token: 'bad' });

    await expect(client.getTaskContext('requirement', 'req-1')).rejects.toThrow(
      'FlowX API request failed (401): Unauthorized',
    );
  });
});
