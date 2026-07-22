import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLOWX_LOCAL_DEFAULT_PORT,
  flowxLocalBaseUrl,
  launchFlowxLocal,
  launchOpenDesignLocal,
  probeFlowxLocal,
  submitOpenDesignLocal,
} from './flowx-local-bridge';

describe('flowx-local-bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the default loopback base url', () => {
    expect(flowxLocalBaseUrl()).toBe(`http://127.0.0.1:${FLOWX_LOCAL_DEFAULT_PORT}`);
    expect(flowxLocalBaseUrl(4000)).toBe('http://127.0.0.1:4000');
  });

  it('probeFlowxLocal returns true when /health responds ok:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, version: '0.1.0' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeFlowxLocal()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:${FLOWX_LOCAL_DEFAULT_PORT}/health`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('probeFlowxLocal returns false on network or non-ok health', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connection refused')),
    );
    await expect(probeFlowxLocal(3921)).resolves.toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ ok: false }),
      }),
    );
    await expect(probeFlowxLocal(3921)).resolves.toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false }),
      }),
    );
    await expect(probeFlowxLocal(3921)).resolves.toBe(false);
  });

  it('launchFlowxLocal posts JSON and returns success payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        gitRoot: '/tmp/repo',
        ide: 'cursor',
        prefilled: true,
        promptPath: '/tmp/repo/.flowx/prompt.md',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const body = {
      ticket: 'ticket-1',
      ide: 'cursor' as const,
      apiBaseUrl: 'http://127.0.0.1:3000',
    };
    await expect(launchFlowxLocal(body, 3922)).resolves.toEqual({
      ok: true,
      gitRoot: '/tmp/repo',
      ide: 'cursor',
      prefilled: true,
      promptPath: '/tmp/repo/.flowx/prompt.md',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3922/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  });

  it('launchFlowxLocal throws Error from { ok:false, error }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ ok: false, error: 'PATH_CANCELLED' }),
      }),
    );

    await expect(
      launchFlowxLocal({
        ticket: 'ticket-1',
        ide: 'codex',
        apiBaseUrl: 'http://127.0.0.1:3000',
      }),
    ).rejects.toThrow('PATH_CANCELLED');
  });

  it('launches and submits OpenDesign sessions through loopback endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          executionSessionId: 'session-1',
          workspacePath: '/tmp/design',
          contextPath: '/tmp/design/context.json',
          resultPath: '/tmp/design/result.json',
          opened: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ queued: false }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await launchOpenDesignLocal(
      { ticket: 'ticket-1', apiBaseUrl: 'http://127.0.0.1:3000' },
      3923,
    );
    await submitOpenDesignLocal('session-1', 3923);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:3923/design/launch');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3923/design/submit');
  });
});
