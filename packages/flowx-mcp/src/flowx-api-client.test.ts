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

  it('fetches design handoff and submits design completion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ executionSessionId: 'session-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new FlowXApiClient({ token: 'token-1' });
    await expect(client.getDesignHandoff('workflow-1')).resolves.toEqual({
      executionSessionId: 'session-1',
    });
    await client.submitDesign('session-1', {
      idempotencyKey: 'k1',
      output: {
        design: {},
        demo: {},
        designArtifact: { html: '<html></html>' },
      },
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:3000/workflow-runs/workflow-1/design/local-handoff',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://127.0.0.1:3000/execution-sessions/session-1/design/complete',
    );
  });
});
