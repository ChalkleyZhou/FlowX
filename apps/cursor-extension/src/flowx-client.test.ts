import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowXClient } from './flowx-client';

describe('FlowXClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists cursor tasks without requiring a workspace id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new FlowXClient({
      apiBaseUrl: 'http://127.0.0.1:3000',
      apiToken: 'token-1',
    });
    await client.listTasks();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/cursor-local/tasks',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
  });
});
