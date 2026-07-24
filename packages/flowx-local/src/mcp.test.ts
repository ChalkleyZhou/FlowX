import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeActiveDesignSession } from './active-design-session.js';
import { writeCredentials } from './credentials.js';
import { createLocalMcpServer } from './mcp.js';
import { readWorkflowBinding, writeWorkflowBinding } from './workflow-binding.js';

const homes: string[] = [];
const originalEnv = {
  FLOWX_API_TOKEN: process.env.FLOWX_API_TOKEN,
  FLOWX_API_BASE_URL: process.env.FLOWX_API_BASE_URL,
};

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
  if (originalEnv.FLOWX_API_TOKEN === undefined) {
    delete process.env.FLOWX_API_TOKEN;
  } else {
    process.env.FLOWX_API_TOKEN = originalEnv.FLOWX_API_TOKEN;
  }
  if (originalEnv.FLOWX_API_BASE_URL === undefined) {
    delete process.env.FLOWX_API_BASE_URL;
  } else {
    process.env.FLOWX_API_BASE_URL = originalEnv.FLOWX_API_BASE_URL;
  }
});

describe('flowx-local MCP server', () => {
  it('identifies as flowx-local and registers the user-facing tools', async () => {
    const { client, server } = await connectClient(makeHome());

    expect(client.getServerVersion()).toMatchObject({ name: 'flowx-local', version: '0.3.0' });
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'flowx_get_active_design_session',
      'flowx_bind_workflow',
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

  it('returns credentials + binding status when no short-lived session is active', async () => {
    const homeDir = makeHome();
    delete process.env.FLOWX_API_TOKEN;
    delete process.env.FLOWX_API_BASE_URL;
    await writeCredentials({ apiBaseUrl: 'https://flowx.example/api', apiToken: 'fxpat_x' }, homeDir);
    await writeWorkflowBinding(
      { workflowRunId: 'wr_bound', stage: 'design', requirementTitle: 'Bound req' },
      homeDir,
    );
    const { client, server } = await connectClient(homeDir);

    const result = await client.callTool({
      name: 'flowx_get_active_design_session',
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(String((result.content as Array<{ text: string }>)[0].text))).toEqual({
      authKind: 'personal_api_token',
      hasCredentials: true,
      binding: {
        workflowRunId: 'wr_bound',
        stage: 'design',
        requirementTitle: 'Bound req',
      },
      message: 'No short-lived active-design session; using credentials + binding.',
    });
    await client.close();
    await server.close();
  });

  it('binds a workflow via flowx_bind_workflow', async () => {
    const homeDir = makeHome();
    const { client, server } = await connectClient(homeDir);

    const result = await client.callTool({
      name: 'flowx_bind_workflow',
      arguments: {
        workflowRunId: 'wr_2',
        stage: 'brainstorm',
        requirementTitle: 'Idea',
      },
    });

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(String((result.content as Array<{ text: string }>)[0].text));
    expect(body.ok).toBe(true);
    expect(body.binding).toMatchObject({
      workflowRunId: 'wr_2',
      stage: 'brainstorm',
      requirementTitle: 'Idea',
    });
    expect(await readWorkflowBinding(homeDir)).toMatchObject({
      workflowRunId: 'wr_2',
      stage: 'brainstorm',
    });

    await client.close();
    await server.close();
  });

  it('uses workflow binding for handoff when no active-design session exists', async () => {
    const homeDir = makeHome();
    delete process.env.FLOWX_API_TOKEN;
    await writeCredentials({ apiBaseUrl: 'https://flowx.example/api', apiToken: 'fxpat_x' }, homeDir);
    await writeWorkflowBinding({ workflowRunId: 'workflow-bound', stage: 'design' }, homeDir);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://flowx.example/api/workflow-runs/workflow-bound/design/local-handoff');
      return new Response(JSON.stringify({ workflowRunId: 'workflow-bound' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { client, server } = await connectClient(homeDir);

    const handoff = await client.callTool({
      name: 'flowx_get_design_handoff',
      arguments: {},
    });
    expect(handoff.content).toEqual([{ type: 'text', text: '{\n  "workflowRunId": "workflow-bound"\n}' }]);

    await client.close();
    await server.close();
  });

  it('errors clearly when handoff has neither param nor binding', async () => {
    const homeDir = makeHome();
    delete process.env.FLOWX_API_TOKEN;
    await writeCredentials({ apiBaseUrl: 'https://flowx.example/api', apiToken: 'fxpat_x' }, homeDir);
    const { client, server } = await connectClient(homeDir);

    const result = await client.callTool({
      name: 'flowx_get_brainstorm_handoff',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(String((result.content as Array<{ text: string }>)[0].text)).toMatch(
      /flowx_list_tasks.*flowx_bind_workflow/,
    );

    await client.close();
    await server.close();
  });

  it('merges cursor-local tasks and opendesign-tasks in flowx_list_tasks', async () => {
    const homeDir = makeHome();
    delete process.env.FLOWX_API_TOKEN;
    await writeCredentials({ apiBaseUrl: 'https://flowx.example/api', apiToken: 'fxpat_x' }, homeDir);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/cursor-local/tasks?workspaceId=ws-1')) {
        return new Response(JSON.stringify([{ id: 'req-1', type: 'requirement' }]), { status: 200 });
      }
      if (url.endsWith('/cursor-local/opendesign-tasks?workspaceId=ws-1')) {
        return new Response(
          JSON.stringify([
            {
              kind: 'opendesign-workflow',
              workflowRunId: 'wf-1',
              requirementId: 'req-1',
              title: 'Idea',
              status: 'BRAINSTORM_PENDING',
              suggestedAction: 'brainstorm',
            },
          ]),
          { status: 200 },
        );
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { client, server } = await connectClient(homeDir);

    const result = await client.callTool({
      name: 'flowx_list_tasks',
      arguments: { workspaceId: 'ws-1' },
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(String((result.content as Array<{ text: string }>)[0].text))).toEqual({
      tasks: [{ id: 'req-1', type: 'requirement' }],
      openDesignWorkflows: [
        {
          kind: 'opendesign-workflow',
          workflowRunId: 'wf-1',
          requirementId: 'req-1',
          title: 'Idea',
          status: 'BRAINSTORM_PENDING',
          suggestedAction: 'brainstorm',
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await client.close();
    await server.close();
  });

  it('advances binding stage to design after successful brainstorm submit', async () => {
    const homeDir = makeHome();
    delete process.env.FLOWX_API_TOKEN;
    await writeCredentials({ apiBaseUrl: 'https://flowx.example/api', apiToken: 'fxpat_x' }, homeDir);
    await writeActiveDesignSession(
      {
        workflowRunId: 'workflow-1',
        executionSessionId: 'session-1',
        apiBaseUrl: 'https://flowx.example/api',
        accessToken: 'session-token',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        stage: 'brainstorm',
      },
      homeDir,
    );
    await writeWorkflowBinding(
      { workflowRunId: 'workflow-1', stage: 'brainstorm', requirementTitle: 'Idea' },
      homeDir,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            workflowRunId: 'workflow-1',
            workflowStatus: 'DESIGN_PENDING',
            next: { stage: 'design', hint: 'call flowx_get_design_handoff' },
          }),
          { status: 200 },
        ),
      ),
    );
    const { client, server } = await connectClient(homeDir);

    const submission = await client.callTool({
      name: 'flowx_submit_brainstorm',
      arguments: {
        report: {
          idempotencyKey: 'brainstorm-1',
          markdown: '# Spec',
        },
      },
    });
    expect(submission.isError).toBeUndefined();
    expect(await readWorkflowBinding(homeDir)).toMatchObject({
      workflowRunId: 'workflow-1',
      stage: 'design',
      requirementTitle: 'Idea',
    });

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
