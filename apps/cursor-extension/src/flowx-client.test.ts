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

  function stubOkFetch() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function makeClient() {
    return new FlowXClient({ apiBaseUrl: 'http://127.0.0.1:3000', apiToken: 'token-1' });
  }

  it('posts completion to the /execution/complete-local route (regression)', async () => {
    const fetchMock = stubOkFetch();
    await makeClient().completeLocal('run-1', { pushed: true, repositories: [] });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/workflow-runs/run-1/execution/complete-local',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('posts session completion to the ExecutionSession API', async () => {
    const fetchMock = stubOkFetch();
    const client = makeClient() as FlowXClient & {
      completeExecutionSession(executionSessionId: string, input: { pushed: boolean; repositories: [] }): Promise<unknown>;
    };

    await client.completeExecutionSession('session-1', { pushed: true, repositories: [] });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/execution-sessions/session-1/complete',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reads a run detail via GET /workflow-runs/:id', async () => {
    const fetchMock = stubOkFetch();
    await makeClient().getRun('run-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/workflow-runs/run-1',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }),
    );
  });

  it('maps stage controls to the correct POST endpoints', async () => {
    const fetchMock = stubOkFetch();
    const client = makeClient();

    await client.confirmPlan('run-1');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:3000/workflow-runs/run-1/plan/confirm',
      expect.objectContaining({ method: 'POST' }),
    );

    await client.reviseDesign('run-1', '调整配色');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:3000/workflow-runs/run-1/design/revise',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ feedback: '调整配色' }) }),
    );

    await client.claimLocal('run-1');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:3000/workflow-runs/run-1/execution/claim-local',
      expect.objectContaining({ method: 'POST' }),
    );

    await client.decideHumanReview('run-1', 'APPROVE');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:3000/workflow-runs/run-1/human-review/decision',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'APPROVE' }) }),
    );
  });
});
