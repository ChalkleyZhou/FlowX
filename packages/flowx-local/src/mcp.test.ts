import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeActiveDesignSession } from './active-design-session.js';
import { createLocalMcpServer } from './mcp.js';

const homes: string[] = [];

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'flowx-local-mcp-'));
  homes.push(home);
  return home;
}

async function connectClient(homeDir: string) {
  const server = createLocalMcpServer({ homeDir });
  const client = new Client({ name: 'flowx-local-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('flowx-local MCP server', () => {
  it('identifies as flowx-local and registers the user-facing tools', async () => {
    const { client, server } = await connectClient(makeHome());

    expect(client.getServerVersion()).toMatchObject({ name: 'flowx-local', version: '0.1.0' });
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'flowx_get_active_design_session',
      'flowx_get_design_handoff',
      'flowx_get_brainstorm_handoff',
      'flowx_submit_design',
      'flowx_submit_brainstorm',
      'flowx_list_tasks',
      'flowx_get_task_context',
      'flowx_collect_git_report',
      'flowx_report_completion',
    ]);

    await client.close();
    await server.close();
  });

  it('returns a useful error when no OpenDesign session is active', async () => {
    const { client, server } = await connectClient(makeHome());

    const result = await client.callTool({
      name: 'flowx_get_active_design_session',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'No active OpenDesign session. Open local OpenDesign from FlowX first.' },
    ]);
    await client.close();
    await server.close();
  });

  it('uses the active session for handoff and design submission', async () => {
    const homeDir = makeHome();
    await writeActiveDesignSession(
      {
        workflowRunId: 'workflow-1',
        executionSessionId: 'session-1',
        apiBaseUrl: 'https://flowx.example/api',
        accessToken: 'session-token',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        stage: 'design',
      },
      homeDir,
    );
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/design/local-handoff')) {
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer session-token');
        return new Response(JSON.stringify({ workflowRunId: 'workflow-1' }), { status: 200 });
      }
      expect(String(input)).toBe('https://flowx.example/api/execution-sessions/session-1/design/complete');
      expect(init).toMatchObject({ method: 'POST' });
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer session-token');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { client, server } = await connectClient(homeDir);

    const handoff = await client.callTool({
      name: 'flowx_get_design_handoff',
      arguments: {},
    });
    expect(handoff.content).toEqual([{ type: 'text', text: '{\n  "workflowRunId": "workflow-1"\n}' }]);

    const submission = await client.callTool({
      name: 'flowx_submit_design',
      arguments: {
        report: {
          idempotencyKey: 'design-1',
          output: {
            design: {},
            demo: {},
            designArtifact: { html: '<main />' },
          },
        },
      },
    });
    expect(submission.content).toEqual([{ type: 'text', text: '{\n  "ok": true\n}' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await client.close();
    await server.close();
  });
});
