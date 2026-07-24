import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { BrainstormCompletionReport, DesignCompletionReport } from '@flowx-ai/protocol';
import { z } from 'zod';
import { readActiveDesignSession } from './active-design-session.js';
import { resolveApiAuth } from './credentials.js';
import { collectGitReport } from './git-report.js';
import {
  missingExecutionSessionError,
  missingWorkflowBindingError,
  readWorkflowBinding,
  resolveExecutionSessionId,
  writeWorkflowBinding,
  type WorkflowBinding,
  type WorkflowBindingStage,
} from './workflow-binding.js';

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
  const auth = await resolveApiAuth(homeDir);
  const binding = await readWorkflowBinding(homeDir);
  return { active, client: new LocalFlowXApiClient(auth.apiBaseUrl, auth.apiToken), auth, binding };
}

function resolveWorkflowRunId(
  param: string | undefined,
  binding: WorkflowBinding | null,
  activeWorkflowRunId?: string,
): string {
  return param?.trim() || binding?.workflowRunId || activeWorkflowRunId?.trim() || '';
}

function readStringField(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field.trim() : '';
}

function inferBindingStage(response: unknown, fallback?: WorkflowBindingStage): WorkflowBindingStage | undefined {
  const explicit = readStringField(response, 'stage');
  if (explicit === 'brainstorm' || explicit === 'design') return explicit;
  const nextStage = readStringField(
    valueHasNext(response) ? (response as { next: { stage?: unknown } }).next : null,
    'stage',
  );
  if (nextStage === 'brainstorm' || nextStage === 'design') return nextStage;
  const workflowStatus = readStringField(response, 'workflowStatus');
  if (workflowStatus === 'DESIGN_PENDING' || workflowStatus === 'DESIGN_WAITING_CONFIRMATION') {
    return 'design';
  }
  if (workflowStatus === 'BRAINSTORM_PENDING') return 'brainstorm';
  return fallback;
}

function valueHasNext(value: unknown): value is { next: unknown } {
  return Boolean(value && typeof value === 'object' && 'next' in value);
}

function shouldAdvanceBindingToDesign(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const body = response as {
    workflowStatus?: unknown;
    next?: { stage?: unknown };
  };
  return body.next?.stage === 'design' || body.workflowStatus === 'DESIGN_PENDING';
}

async function refreshBindingFromHandoff(
  homeDir: string | undefined,
  response: unknown,
  binding: WorkflowBinding | null,
  workflowRunIdHint?: string,
  stageFallback?: WorkflowBindingStage,
) {
  const workflowRunId =
    readStringField(response, 'workflowRunId') ||
    binding?.workflowRunId ||
    workflowRunIdHint?.trim() ||
    '';
  const executionSessionId = readStringField(response, 'executionSessionId');
  const stage = inferBindingStage(response, stageFallback ?? binding?.stage);
  if (!workflowRunId || !stage) return;
  await writeWorkflowBinding(
    {
      workflowRunId,
      stage,
      ...(binding?.requirementTitle ? { requirementTitle: binding.requirementTitle } : {}),
      ...(executionSessionId ? { executionSessionId } : {}),
    },
    homeDir,
  );
}

async function maybeAdvanceBindingAfterBrainstorm(
  homeDir: string | undefined,
  response: unknown,
  binding: WorkflowBinding | null,
  workflowRunIdHint?: string,
) {
  if (!shouldAdvanceBindingToDesign(response)) return;
  const workflowRunId =
    readStringField(response, 'workflowRunId') ||
    binding?.workflowRunId ||
    workflowRunIdHint?.trim() ||
    '';
  if (!workflowRunId) return;
  const designSessionId = readStringField(response, 'executionSessionId');
  await writeWorkflowBinding(
    {
      workflowRunId,
      stage: 'design',
      ...(binding?.requirementTitle ? { requirementTitle: binding.requirementTitle } : {}),
      // 构思 session 不可用于 design submit；仅当响应已给出 design session 时写入。
      ...(designSessionId ? { executionSessionId: designSessionId } : {}),
    },
    homeDir,
  );
}

async function runRequest(request: () => Promise<unknown>) {
  try {
    return textResult(await request());
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }
}

export function createLocalMcpServer(options: LocalMcpOptions = {}) {
  const server = new McpServer({ name: 'flowx-local', version: '0.4.1' });

  server.registerTool(
    'flowx_get_active_design_session',
    {
      title: 'Get Active OpenDesign Session',
      description:
        'Read the active FlowX OpenDesign short-lived session, or credentials + workflow binding status when none exists.',
      inputSchema: z.object({ refresh: z.boolean().optional() }),
    },
    async () => {
      const active = await readActiveDesignSession(options.homeDir);
      const activeExpired =
        !!active && Date.parse(active.accessTokenExpiresAt) <= Date.now();

      // 未过期的短期会话仍直接返回；已过期则改走 credentials / binding，避免 Agent 卡在「token 已过期」。
      if (active && !activeExpired) {
        return textResult({
          workflowRunId: active.workflowRunId,
          executionSessionId: active.executionSessionId,
          apiBaseUrl: active.apiBaseUrl,
          accessTokenExpiresAt: active.accessTokenExpiresAt,
          accessTokenExpired: false,
          stage: active.stage ?? 'design',
          updatedAt: active.updatedAt,
        });
      }

      const binding = await readWorkflowBinding(options.homeDir);
      let hasCredentials = false;
      let authKind: 'personal_api_token' | null = null;
      let apiBaseUrl: string | null = null;
      try {
        const auth = await resolveApiAuth(options.homeDir);
        hasCredentials = true;
        apiBaseUrl = auth.apiBaseUrl;
        authKind = auth.source === 'active-design' ? null : 'personal_api_token';
      } catch {
        hasCredentials = false;
      }

      return textResult({
        authKind,
        hasCredentials,
        apiBaseUrl,
        binding: binding
          ? {
              workflowRunId: binding.workflowRunId,
              stage: binding.stage,
              ...(binding.requirementTitle ? { requirementTitle: binding.requirementTitle } : {}),
              ...(binding.executionSessionId ? { executionSessionId: binding.executionSessionId } : {}),
            }
          : null,
        expiredActiveDesignIgnored: activeExpired,
        message: hasCredentials
          ? activeExpired
            ? 'Short-lived active-design token is expired; using credentials + binding instead.'
            : 'No short-lived active-design session; using credentials + binding.'
          : activeExpired
            ? 'Short-lived active-design token is expired and no credentials were found. Run flowx-local login --api-base-url <FlowX API URL> --token fxpat_…'
            : 'No short-lived active-design session and no credentials. Run flowx-local login, set FLOWX_API_TOKEN, or open local OpenDesign from FlowX.',
      });
    },
  );

  server.registerTool(
    'flowx_bind_workflow',
    {
      title: 'Bind Current Workflow',
      description:
        'Persist the current workflowRunId and stage to ~/.flowx/current-workflow.json after the user confirms a task from flowx_list_tasks.',
      inputSchema: z.object({
        workflowRunId: z.string().min(1),
        stage: z.enum(['brainstorm', 'design']),
        requirementTitle: z.string().optional(),
      }),
    },
    async ({ workflowRunId, stage, requirementTitle }) => {
      try {
        const binding = await writeWorkflowBinding(
          {
            workflowRunId,
            stage,
            ...(requirementTitle?.trim() ? { requirementTitle: requirementTitle.trim() } : {}),
          },
          options.homeDir,
        );
        return textResult({ ok: true, binding });
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), true);
      }
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
      const { active, client, binding } = await resolveSession(options.homeDir);
      const id = resolveWorkflowRunId(workflowRunId, binding, active?.workflowRunId);
      if (!id) return textResult(missingWorkflowBindingError(), true);
      return runRequest(async () => {
        const response = await client.request(
          `/workflow-runs/${encodeURIComponent(id)}/design/local-handoff`,
        );
        await refreshBindingFromHandoff(options.homeDir, response, binding, id, 'design');
        return response;
      });
    },
  );

  server.registerTool(
    'flowx_get_brainstorm_handoff',
    {
      title: 'Get OpenDesign Brainstorm Handoff',
      description:
        'Fetch brainstorm context for the active FlowX session. Clarify with the user, write confirmed spec.md, then submit.',
      inputSchema: z.object({ workflowRunId: z.string().optional() }),
    },
    async ({ workflowRunId }) => {
      const { active, client, binding } = await resolveSession(options.homeDir);
      const id = resolveWorkflowRunId(workflowRunId, binding, active?.workflowRunId);
      if (!id) return textResult(missingWorkflowBindingError(), true);
      return runRequest(async () => {
        const response = await client.request(
          `/workflow-runs/${encodeURIComponent(id)}/brainstorm/local-handoff`,
        );
        await refreshBindingFromHandoff(options.homeDir, response, binding, id, 'brainstorm');
        return response;
      });
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
      const { active, client, binding } = await resolveSession(options.homeDir);
      const id = resolveExecutionSessionId(executionSessionId, binding, active?.executionSessionId);
      if (!id) return textResult(missingExecutionSessionError(), true);
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
      description:
        'Submit confirmed product spec Markdown (spec.md) to FlowX after the user explicitly approved it. Do not submit drafts or chat transcripts.',
      inputSchema: z.object({
        executionSessionId: z.string().optional(),
        report: brainstormReportSchema,
      }),
    },
    async ({ executionSessionId, report }) => {
      const { active, client, binding } = await resolveSession(options.homeDir);
      const id = resolveExecutionSessionId(executionSessionId, binding, active?.executionSessionId);
      if (!id) return textResult(missingExecutionSessionError(), true);
      const parsed = brainstormReportSchema.safeParse(report);
      if (!parsed.success) return textResult(`Invalid brainstorm report: ${parsed.error.message}`, true);
      try {
        const response = await client.request(
          `/execution-sessions/${encodeURIComponent(id)}/brainstorm/complete`,
          {
            method: 'POST',
            body: JSON.stringify(parsed.data satisfies BrainstormCompletionReport),
          },
        );
        await maybeAdvanceBindingAfterBrainstorm(
          options.homeDir,
          response,
          binding,
          active?.workflowRunId,
        );
        return textResult(response);
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), true);
      }
    },
  );

  server.registerTool(
    'flowx_list_tasks',
    {
      title: 'List FlowX Tasks',
      description:
        'List FlowX requirements/bugs and OpenDesign brainstorm/design candidate workflows. Confirm a workflow with the user, then call flowx_bind_workflow.',
      inputSchema: z.object({ workspaceId: z.string().optional() }),
    },
    async ({ workspaceId }) => {
      const { client } = await resolveSession(options.homeDir);
      const query = workspaceId?.trim() ? `?workspaceId=${encodeURIComponent(workspaceId.trim())}` : '';
      return runRequest(async () => {
        const [tasks, openDesignWorkflows] = await Promise.all([
          client.request(`/cursor-local/tasks${query}`),
          client.request(`/cursor-local/opendesign-tasks${query}`),
        ]);
        return { tasks, openDesignWorkflows };
      });
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
