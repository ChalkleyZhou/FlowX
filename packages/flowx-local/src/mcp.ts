import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ARTIFACT_TYPES,
  type ArtifactType,
  type BrainstormCompletionReport,
  type DesignCompletionReport,
  type LocalSmokeCompletionReport,
  type SpecPlanCompletionReport,
} from '@flowx-ai/protocol';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { z } from 'zod';
import { readActiveDesignSession } from './active-design-session.js';
import { PACKAGE_VERSION } from './config.js';
import { resolveApiAuth } from './credentials.js';
import { collectGitReport } from './git-report.js';
import { Outbox } from './outbox.js';
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

  async upload(path: string, content: Buffer, contentType = 'application/octet-stream') {
    const body = new Uint8Array(content.byteLength);
    body.set(content);
    return this.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body,
    });
  }
}

const designReportSchema = z.object({
  idempotencyKey: z.string().min(1),
  markdown: z.string().min(1),
  summary: z.string().optional(),
  output: z.object({
    design: z.record(z.string(), z.unknown()),
    demo: z.record(z.string(), z.unknown()),
    surfaces: z
      .array(
        z.object({
          id: z.string().min(1),
          pages: z
            .array(
              z.object({
                id: z.string().min(1),
                title: z.string().optional(),
                html: z.string().min(1),
              }).passthrough(),
            )
            .min(1),
        }).passthrough(),
      )
      .min(1),
  }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const brainstormReportSchema = z.object({
  idempotencyKey: z.string().min(1),
  markdown: z.string().min(1),
  summary: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const specPlanOutputSchema = z.object({
  spec: z.object({
    goal: z.string().min(1),
    scope: z.array(z.string()),
    nonGoals: z.array(z.string()),
    acceptanceCriteria: z.array(z.string()),
    constraints: z.array(z.string()),
  }),
  plan: z.object({
    approach: z.string().min(1),
    touchpoints: z.array(z.string()),
    sequence: z.array(z.string()),
    risks: z.array(z.string()),
    verification: z.array(z.string()),
  }),
  notes: z
    .object({
      checklist: z.array(z.string()).optional(),
      openQuestions: z.array(z.string()).optional(),
    })
    .optional(),
});

const specPlanReportSchema = z.object({
  idempotencyKey: z.string().min(1),
  sourceFingerprint: z.string().min(1),
  output: specPlanOutputSchema,
  artifactIds: z.array(z.string().min(1)).min(2),
  summary: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const repositoryRevisionSchema = z.object({
  workflowRepositoryId: z.string().min(1),
  branch: z.string(),
  headSha: z.string().min(1),
});

const smokeTargetSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  required: z.boolean().optional(),
  expectedRevisions: z.array(repositoryRevisionSchema).optional(),
});

const smokeReportSchema = z.object({
  idempotencyKey: z.string().min(1),
  sourceFingerprint: z.string().min(1),
  environment: z.record(z.string(), z.unknown()).optional(),
  testedRevisions: z.array(repositoryRevisionSchema),
  caseResults: z
    .array(
      z.object({
        testRunCaseId: z.string().min(1),
        result: z.enum(['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED']),
        durationMs: z.number().int().nonnegative().optional(),
        actualResult: z.string().optional(),
        remark: z.string().optional(),
        artifactIds: z.array(z.string().min(1)).optional(),
      }),
    )
    .min(1),
  summary: z.string().optional(),
  artifactIds: z.array(z.string().min(1)).optional(),
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inferBindingStage(response: unknown, fallback?: WorkflowBindingStage): WorkflowBindingStage | undefined {
  const explicit = readStringField(response, 'stage');
  if (explicit === 'brainstorm' || explicit === 'design' || explicit === 'spec-plan') return explicit;
  const nextStage = readStringField(
    valueHasNext(response) ? (response as { next: { stage?: unknown } }).next : null,
    'stage',
  );
  if (nextStage === 'brainstorm' || nextStage === 'design' || nextStage === 'spec-plan') return nextStage;
  const workflowStatus = readStringField(response, 'workflowStatus');
  if (workflowStatus === 'DESIGN_PENDING' || workflowStatus === 'DESIGN_WAITING_CONFIRMATION') {
    return 'design';
  }
  if (workflowStatus === 'BRAINSTORM_PENDING') return 'brainstorm';
  if (
    workflowStatus === 'SPEC_PLAN_PENDING' ||
    workflowStatus === 'SPEC_PLAN_WAITING_CONFIRMATION'
  ) {
    return 'spec-plan';
  }
  return fallback;
}

function valueHasNext(value: unknown): value is { next: unknown } {
  return Boolean(value && typeof value === 'object' && 'next' in value);
}

function summarizeProjects(raw: unknown) {
  const list = Array.isArray(raw) ? raw : [];
  return {
    projects: list.map((item) => {
      const project = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const workspace =
        project.workspace && typeof project.workspace === 'object'
          ? (project.workspace as Record<string, unknown>)
          : {};
      const repositories = Array.isArray(workspace.repositories) ? workspace.repositories : [];
      return {
        id: typeof project.id === 'string' ? project.id : '',
        name: typeof project.name === 'string' ? project.name : '',
        workspaceId:
          typeof project.workspaceId === 'string'
            ? project.workspaceId
            : typeof workspace.id === 'string'
              ? workspace.id
              : '',
        workspaceName: typeof workspace.name === 'string' ? workspace.name : '',
        repositories: repositories.map((repo) => {
          const row = repo && typeof repo === 'object' ? (repo as Record<string, unknown>) : {};
          return {
            id: typeof row.id === 'string' ? row.id : '',
            name: typeof row.name === 'string' ? row.name : '',
          };
        }),
        currentVersion: summarizeVersion(project.currentVersion),
        versions: (Array.isArray(project.versions) ? project.versions : [])
          .map((row) => summarizeVersion(row))
          .filter((row): row is { id: string; name: string } => row !== null),
      };
    }),
  };
}

function summarizeVersion(raw: unknown): { id: string; name: string } | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const version = raw as Record<string, unknown>;
  const id = typeof version.id === 'string' ? version.id : '';
  const name = typeof version.name === 'string' ? version.name : '';
  if (!id && !name) {
    return null;
  }
  return { id, name };
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
  const server = new McpServer({ name: 'flowx-local', version: PACKAGE_VERSION });

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
        stage: z.enum(['brainstorm', 'design', 'spec-plan']),
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
        'Fetch brainstorm context for the active FlowX session. Brainstorm first with the user to clarify product requirements, write a confirmed prd.md for PM/designer review, then submit.',
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
    'flowx_get_spec_plan_handoff',
    {
      title: 'Get Local Spec & Plan Handoff',
      description: 'Fetch the versioned context for a locally generated FlowX Spec & Plan.',
      inputSchema: z.object({ workflowRunId: z.string().optional() }),
    },
    async ({ workflowRunId }) => {
      const { active, client, binding } = await resolveSession(options.homeDir);
      const id = resolveWorkflowRunId(workflowRunId, binding, active?.workflowRunId);
      if (!id) return textResult(missingWorkflowBindingError(), true);
      return runRequest(async () => {
        const response = await client.request(
          `/workflow-runs/${encodeURIComponent(id)}/spec-plan/local-handoff`,
        );
        await refreshBindingFromHandoff(options.homeDir, response, binding, id, 'spec-plan');
        return response;
      });
    },
  );

  server.registerTool(
    'flowx_upload_artifact',
    {
      title: 'Upload FlowX Artifact',
      description:
        'Upload a local log, screenshot, report, Spec, Plan, manifest, or coverage file to the active FlowX execution session.',
      inputSchema: z.object({
        executionSessionId: z.string().optional(),
        filePath: z.string().min(1),
        artifactType: z.enum(ARTIFACT_TYPES),
        name: z.string().min(1).optional(),
        version: z.string().min(1).optional(),
        mimeType: z.string().min(1).optional(),
      }),
    },
    async ({ executionSessionId, filePath, artifactType, name, version, mimeType }) => {
      const { active, client, binding, auth } = await resolveSession(options.homeDir);
      const id = resolveExecutionSessionId(executionSessionId, binding, active?.executionSessionId);
      if (!id) return textResult(missingExecutionSessionError(), true);
      return runRequest(async () => {
        const resolvedPath = resolve(filePath);
        const content = await readFile(resolvedPath);
        const sha256 = createHash('sha256').update(content).digest('hex');
        const createPath = `/execution-sessions/${encodeURIComponent(id)}/artifact-uploads`;
        const createBody = {
          artifactType: artifactType satisfies ArtifactType,
          name: name?.trim() || basename(resolvedPath),
          ...(version?.trim() ? { version: version.trim() } : {}),
          ...(mimeType?.trim() ? { mimeType: mimeType.trim() } : {}),
          byteSize: content.byteLength,
          sha256,
        };
        const artifactId = createHash('sha256')
          .update(`${id}:${artifactType}:${sha256}`)
          .digest('hex')
          .slice(0, 32);
        const uploadPath = `/artifacts/${artifactId}/content`;
        try {
          const created = (await client.request(createPath, {
            method: 'POST',
            body: JSON.stringify(createBody),
          })) as {
            artifact?: { id?: string };
            upload?: { path?: string; contentType?: string };
          };
          const uploadedArtifactId = created.artifact?.id?.trim() || artifactId;
          const uploaded = await client.upload(
            created.upload?.path?.trim() || uploadPath,
            content,
            created.upload?.contentType || mimeType || 'application/octet-stream',
          );
          return {
            artifactId: uploadedArtifactId,
            sha256,
            byteSize: content.byteLength,
            ...asRecord(uploaded),
          };
        } catch (error) {
          const outbox = new Outbox({ homeDir: options.homeDir });
          await outbox.enqueueArtifactContent(
            {
              eventId: `artifact-${artifactId}`,
              kind: 'artifact-upload',
              credentialRef: `api-auth:${id}`,
              apiBaseUrl: auth.apiBaseUrl,
              path: createPath,
              uploadPath,
              method: 'ARTIFACT_UPLOAD',
              body: createBody,
              contentType: mimeType || 'application/octet-stream',
              sha256,
            },
            content,
          );
          return {
            artifactId,
            sha256,
            byteSize: content.byteLength,
            queued: true,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
    },
  );

  server.registerTool(
    'flowx_submit_spec_plan',
    {
      title: 'Submit Local Spec & Plan',
      description:
        'Submit structured Spec & Plan after uploading both SPEC_MARKDOWN and PLAN_MARKDOWN artifacts.',
      inputSchema: z.object({
        executionSessionId: z.string().optional(),
        report: specPlanReportSchema,
      }),
    },
    async ({ executionSessionId, report }) => {
      const { active, client, binding } = await resolveSession(options.homeDir);
      const id = resolveExecutionSessionId(executionSessionId, binding, active?.executionSessionId);
      if (!id) return textResult(missingExecutionSessionError(), true);
      const parsed = specPlanReportSchema.safeParse(report);
      if (!parsed.success) {
        return textResult(`Invalid Spec & Plan report: ${parsed.error.message}`, true);
      }
      return runRequest(() =>
        client.request(`/execution-sessions/${encodeURIComponent(id)}/spec-plan/complete`, {
          method: 'POST',
          body: JSON.stringify(parsed.data satisfies SpecPlanCompletionReport),
        }),
      );
    },
  );

  server.registerTool(
    'flowx_create_smoke_run',
    {
      title: 'Create Local Smoke Run',
      description: 'Create a multi-target local smoke run from a FlowX test request snapshot.',
      inputSchema: z.object({
        testRequestId: z.string().min(1),
        name: z.string().min(1),
        targets: z.array(smokeTargetSchema).min(1),
        snapshotIds: z.array(z.string().min(1)).optional(),
      }),
    },
    async ({ testRequestId, ...body }) => {
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() =>
        client.request(
          `/quality/test-requests/${encodeURIComponent(testRequestId)}/local-smoke-runs`,
          { method: 'POST', body: JSON.stringify(body) },
        ),
      );
    },
  );

  server.registerTool(
    'flowx_list_smoke_tasks',
    {
      title: 'List Local Smoke Tasks',
      description: 'List target, case, claim, and aggregate status for a local smoke run.',
      inputSchema: z.object({ testRunId: z.string().min(1) }),
    },
    async ({ testRunId }) => {
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() =>
        client.request(`/quality/local-smoke-runs/${encodeURIComponent(testRunId)}/tasks`),
      );
    },
  );

  server.registerTool(
    'flowx_claim_smoke_task',
    {
      title: 'Claim Local Smoke Task',
      description: 'Claim available smoke cases for one target with a server-managed lease.',
      inputSchema: z.object({
        testRunId: z.string().min(1),
        targetId: z.string().min(1),
        caseIds: z.array(z.string().min(1)).optional(),
        deviceId: z.string().min(1).optional(),
        leaseSeconds: z.number().int().min(60).max(86400).optional(),
      }),
    },
    async ({ testRunId, ...body }) => {
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() =>
        client.request(`/quality/local-smoke-runs/${encodeURIComponent(testRunId)}/claim`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    },
  );

  server.registerTool(
    'flowx_submit_smoke_report',
    {
      title: 'Submit Local Smoke Report',
      description:
        'Submit case results and uploaded artifact ids for one claimed local smoke execution.',
      inputSchema: z.object({
        executionSessionId: z.string().min(1),
        report: smokeReportSchema,
      }),
    },
    async ({ executionSessionId, report }) => {
      const { client } = await resolveSession(options.homeDir);
      const parsed = smokeReportSchema.safeParse(report);
      if (!parsed.success) {
        return textResult(`Invalid smoke report: ${parsed.error.message}`, true);
      }
      return runRequest(() =>
        client.request(
          `/execution-sessions/${encodeURIComponent(executionSessionId)}/local-smoke/complete`,
          {
            method: 'POST',
            body: JSON.stringify(parsed.data satisfies LocalSmokeCompletionReport),
          },
        ),
      );
    },
  );

  server.registerTool(
    'flowx_submit_design',
    {
      title: 'Submit OpenDesign Result',
      description:
        'Submit the confirmed design.md Markdown and complete OpenDesign result back to FlowX.',
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
        'Submit confirmed product PRD Markdown (prd.md) to FlowX after the user explicitly approved it. Legacy spec.md is still accepted by the adapter. Do not submit drafts or chat transcripts.',
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
    'flowx_list_projects',
    {
      title: 'List FlowX Projects',
      description:
        'List workspaces/projects for FlowX requirement intake only after the user explicitly asked to create/register the item in FlowX or confirmed that choice. Do not use for ordinary code changes, current-project feature work, or requirement discussion. If intent is unclear, ask whether to handle it in the current project or register it in FlowX before calling any FlowX tool. Ask the user to pick a projectId; do not infer from local repo paths.',
      inputSchema: z.object({}),
    },
    async () => {
      const { client } = await resolveSession(options.homeDir);
      return runRequest(async () => summarizeProjects(await client.request('/projects')));
    },
  );

  server.registerTool(
    'flowx_create_project_version',
    {
      title: 'Create FlowX Project Version',
      description:
        'Create a release version on a FlowX project. For local intake, pass setAsCurrent=true only after the user chose to create a new version instead of using the current one.',
      inputSchema: z.object({
        projectId: z.string().min(1),
        name: z.string().min(1),
        setAsCurrent: z.boolean().optional(),
      }),
    },
    async (input) => {
      const { client } = await resolveSession(options.homeDir);
      return runRequest(async () => {
        const created = await client.request(`/projects/${encodeURIComponent(input.projectId)}/versions`, {
          method: 'POST',
          body: JSON.stringify({ name: input.name }),
        });
        if (input.setAsCurrent === true && created && typeof created === 'object' && 'id' in created) {
          await client.request(`/projects/${encodeURIComponent(input.projectId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ currentVersionId: (created as { id: string }).id }),
          });
        }
        return created;
      });
    },
  );

  server.registerTool(
    'flowx_create_requirement',
    {
      title: 'Create FlowX Requirement',
      description:
        'Create a requirement on FlowX only after the user explicitly asked to create/register the item in FlowX or confirmed that choice. Never interpret ordinary code changes, current-project feature work, or requirement discussion as authorization to create FlowX data. Requires projectId, title, description, acceptanceCriteria. Confirm the release version with the user first and always pass versionId (id or null); do not omit it to rely on server default.',
      inputSchema: z.object({
        projectId: z.string().min(1),
        title: z.string().min(1),
        description: z.string().min(1),
        acceptanceCriteria: z.string().min(1),
        repositoryIds: z.array(z.string()).optional(),
        versionId: z.string().min(1).nullable().optional(),
      }),
    },
    async (input) => {
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() =>
        client.request('/requirements', {
          method: 'POST',
          body: JSON.stringify({
            projectId: input.projectId,
            title: input.title,
            description: input.description,
            acceptanceCriteria: input.acceptanceCriteria,
            ...(input.repositoryIds?.length ? { repositoryIds: input.repositoryIds } : {}),
            ...(input.versionId !== undefined ? { versionId: input.versionId } : {}),
          }),
        }),
      );
    },
  );

  server.registerTool(
    'flowx_start_workflow',
    {
      title: 'Start FlowX Workflow',
      description:
        'Start a workflow for an existing requirement after showing the user a start summary and receiving explicit confirmation. Always pass userConfirmedStart=true only after that confirmation. Then ask whether to continue into product brainstorm (bind + flowx-product-prd) or stop.',
      inputSchema: z.object({
        requirementId: z.string().min(1),
        userConfirmedStart: z.boolean(),
        repositoryIds: z.array(z.string()).optional(),
        aiProvider: z.enum(['codex', 'cursor']).optional(),
      }),
    },
    async (input) => {
      if (input.userConfirmedStart !== true) {
        return textResult(
          'Refusing to start workflow: userConfirmedStart must be true after the user explicitly confirmed the start summary.',
          true,
        );
      }
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() =>
        client.request('/workflow-runs', {
          method: 'POST',
          body: JSON.stringify({
            requirementId: input.requirementId,
            ...(input.repositoryIds?.length ? { repositoryIds: input.repositoryIds } : {}),
            ...(input.aiProvider ? { aiProvider: input.aiProvider } : {}),
          }),
        }),
      );
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
