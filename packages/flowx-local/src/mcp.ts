import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { BrainstormCompletionReport, DesignCompletionReport } from '@flowx-ai/protocol';
import { z } from 'zod';
import { readActiveDesignSession } from './active-design-session.js';
import { collectGitReport } from './git-report.js';

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: 'text'; text: string }>;
};

class LocalFlowXApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`FlowX API request failed (${response.status}): ${message || response.statusText}`);
    }
    return response.json();
  }
}

const designReportSchema = z.object({
  idempotencyKey: z.string().min(1),
  summary: z.string().optional(),
  output: z.object({
    design: z.record(z.string(), z.unknown()),
    demo: z.record(z.string(), z.unknown()),
    designArtifact: z.object({ html: z.string().min(1) }).passthrough(),
  }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const brainstormReportSchema = z.object({
  idempotencyKey: z.string().min(1),
  markdown: z.string().min(1),
  summary: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function textResult(value: unknown, isError = false): ToolResult {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  };
}

export type LocalMcpOptions = {
  homeDir?: string;
};

async function resolveSession(homeDir?: string) {
  const active = await readActiveDesignSession(homeDir);
  const baseUrl = (process.env.FLOWX_API_BASE_URL ?? active?.apiBaseUrl ?? '').replace(/\/+$/, '');
  const token = process.env.FLOWX_API_TOKEN ?? active?.accessToken ?? '';
  if (!baseUrl) {
    throw new Error('No FlowX API URL is available. Start flowx-local and open a FlowX local session first.');
  }
  return { active, client: new LocalFlowXApiClient(baseUrl, token) };
}

async function runRequest(request: () => Promise<unknown>) {
  try {
    return textResult(await request());
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }
}

export function createLocalMcpServer(options: LocalMcpOptions = {}) {
  const server = new McpServer({ name: 'flowx-local', version: '0.1.0' });

  server.registerTool(
    'flowx_get_active_design_session',
    {
      title: 'Get Active OpenDesign Session',
      description: 'Read the active FlowX OpenDesign session managed by flowx-local.',
      inputSchema: z.object({ refresh: z.boolean().optional() }),
    },
    async () => {
      const active = await readActiveDesignSession(options.homeDir);
      if (!active) {
        return textResult('No active OpenDesign session. Open local OpenDesign from FlowX first.', true);
      }
      return textResult({
        workflowRunId: active.workflowRunId,
        executionSessionId: active.executionSessionId,
        apiBaseUrl: active.apiBaseUrl,
        accessTokenExpiresAt: active.accessTokenExpiresAt,
        accessTokenExpired: Date.parse(active.accessTokenExpiresAt) <= Date.now(),
        stage: active.stage ?? 'design',
        updatedAt: active.updatedAt,
      });
    },
  );

  server.registerTool(
    'flowx_get_design_handoff',
    {
      title: 'Get OpenDesign Handoff',
      description: 'Fetch the versioned OpenDesign context for the active FlowX design session.',
      inputSchema: z.object({ workflowRunId: z.string().optional() }),
    },
    async ({ workflowRunId }) => {
      const { active, client } = await resolveSession(options.homeDir);
      const id = workflowRunId?.trim() || active?.workflowRunId;
      if (!id) return textResult('workflowRunId is required when there is no active design session.', true);
      return runRequest(() => client.request(`/workflow-runs/${encodeURIComponent(id)}/design/local-handoff`));
    },
  );

  server.registerTool(
    'flowx_get_brainstorm_handoff',
    {
      title: 'Get OpenDesign Brainstorm Handoff',
      description: 'Fetch the versioned OpenDesign brainstorm context for the active FlowX session.',
      inputSchema: z.object({ workflowRunId: z.string().optional() }),
    },
    async ({ workflowRunId }) => {
      const { active, client } = await resolveSession(options.homeDir);
      const id = workflowRunId?.trim() || active?.workflowRunId;
      if (!id) return textResult('workflowRunId is required when there is no active brainstorm session.', true);
      return runRequest(() => client.request(`/workflow-runs/${encodeURIComponent(id)}/brainstorm/local-handoff`));
    },
  );

  server.registerTool(
    'flowx_submit_design',
    {
      title: 'Submit OpenDesign Result',
      description: 'Submit a complete OpenDesign result back to FlowX.',
      inputSchema: z.object({
        executionSessionId: z.string().optional(),
        report: designReportSchema,
      }),
    },
    async ({ executionSessionId, report }) => {
      const { active, client } = await resolveSession(options.homeDir);
      const id = executionSessionId?.trim() || active?.executionSessionId;
      if (!id) return textResult('executionSessionId is required when there is no active design session.', true);
      const parsed = designReportSchema.safeParse(report);
      if (!parsed.success) return textResult(`Invalid design report: ${parsed.error.message}`, true);
      return runRequest(() =>
        client.request(`/execution-sessions/${encodeURIComponent(id)}/design/complete`, {
          method: 'POST',
          body: JSON.stringify(parsed.data satisfies DesignCompletionReport),
        }),
      );
    },
  );

  server.registerTool(
    'flowx_submit_brainstorm',
    {
      title: 'Submit OpenDesign Brainstorm',
      description: 'Submit brainstorm Markdown back to FlowX.',
      inputSchema: z.object({
        executionSessionId: z.string().optional(),
        report: brainstormReportSchema,
      }),
    },
    async ({ executionSessionId, report }) => {
      const { active, client } = await resolveSession(options.homeDir);
      const id = executionSessionId?.trim() || active?.executionSessionId;
      if (!id) return textResult('executionSessionId is required when there is no active brainstorm session.', true);
      const parsed = brainstormReportSchema.safeParse(report);
      if (!parsed.success) return textResult(`Invalid brainstorm report: ${parsed.error.message}`, true);
      return runRequest(() =>
        client.request(`/execution-sessions/${encodeURIComponent(id)}/brainstorm/complete`, {
          method: 'POST',
          body: JSON.stringify(parsed.data satisfies BrainstormCompletionReport),
        }),
      );
    },
  );

  server.registerTool(
    'flowx_list_tasks',
    {
      title: 'List FlowX Tasks',
      description: 'List FlowX requirements and bugs available for local work.',
      inputSchema: z.object({ workspaceId: z.string().optional() }),
    },
    async ({ workspaceId }) => {
      const { client } = await resolveSession(options.homeDir);
      const query = workspaceId?.trim() ? `?workspaceId=${encodeURIComponent(workspaceId.trim())}` : '';
      return runRequest(() => client.request(`/cursor-local/tasks${query}`));
    },
  );

  server.registerTool(
    'flowx_get_task_context',
    {
      title: 'Get FlowX Task Context',
      description: 'Read the context for a FlowX requirement or bug.',
      inputSchema: z.object({ type: z.enum(['requirement', 'bug']), id: z.string() }),
    },
    async ({ type, id }) => {
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() => client.request(`/cursor-local/tasks/${encodeURIComponent(type)}/${encodeURIComponent(id)}/context`));
    },
  );

  server.registerTool(
    'flowx_collect_git_report',
    {
      title: 'Collect Git Report',
      description: 'Collect current branch, HEAD, changed files, untracked files, and diff summary.',
      inputSchema: z.object({ cwd: z.string().optional() }),
    },
    async ({ cwd }) => textResult(await collectGitReport(cwd?.trim() || process.cwd())),
  );

  server.registerTool(
    'flowx_report_completion',
    {
      title: 'Report FlowX Completion',
      description: 'Collect local Git state and report local execution completion to FlowX.',
      inputSchema: z.object({
        workflowRunId: z.string(),
        workflowRepositoryId: z.string(),
        implementationSummary: z.string(),
        testResult: z.string(),
        pushed: z.boolean(),
        cwd: z.string().optional(),
      }),
    },
    async (input) => {
      const report = await collectGitReport(input.cwd?.trim() || process.cwd());
      if (report.changedFiles.length === 0) return textResult('No changed files were found.', true);
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() =>
        client.request(`/workflow-runs/${encodeURIComponent(input.workflowRunId)}/execution/complete-local`, {
          method: 'POST',
          body: JSON.stringify({
            pushed: input.pushed,
            implementationSummary: input.implementationSummary,
            testResult: input.testResult,
            diffSummary: report.diffSummary,
            untrackedFiles: report.untrackedFiles,
            repositories: [{
              workflowRepositoryId: input.workflowRepositoryId,
              headSha: report.headSha,
              changedFiles: report.changedFiles,
              patchSummary: input.implementationSummary,
            }],
          }),
        }),
      );
    },
  );

  return server;
}

export async function runLocalMcp() {
  const server = createLocalMcpServer();
  await server.connect(new StdioServerTransport());
}
