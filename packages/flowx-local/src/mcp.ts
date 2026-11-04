import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ARTIFACT_TYPES,
  type ExecutionCheckpointResult,
  type ArtifactType,
  type BrainstormCompletionReport,
  type DesignCompletionReport,
  type LocalSmokeCompletionReport,
  type SpecPlanCompletionReport,
} from '@flowx-ai/protocol';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { z } from 'zod';
import { readActiveDesignSession } from './active-design-session.js';
import { PACKAGE_VERSION } from './config.js';
import { resolveApiAuth } from './credentials.js';
import { ensureDeviceIdentity } from './device.js';
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

  async requestForm(path: string, form: FormData) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      body: form,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`FlowX API request failed (${response.status}): ${message || response.statusText}`);
    }
    return response.json();
  }
}

const requirementPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

function requirementProfileBody(input: {
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  functionalModule?: string;
  riskImpact?: string;
  productRequirementDocument?: string;
  remark?: string;
}) {
  return {
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.functionalModule !== undefined ? { functionalModule: input.functionalModule } : {}),
    ...(input.riskImpact !== undefined ? { riskImpact: input.riskImpact } : {}),
    ...(input.productRequirementDocument !== undefined ? { productRequirementDocument: input.productRequirementDocument } : {}),
    ...(input.remark !== undefined ? { remark: input.remark } : {}),
  };
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

  // 新能力先做服务端能力识别；不支持时不能退回冒烟入口误执行。
  async function qualityRequest(path: string, init?: RequestInit) {
    const { client } = await resolveSession(options.homeDir);
    const capabilities = await client.request('/quality/capabilities') as { capabilities?: string[] };
    if (!capabilities.capabilities?.includes('local-test-runs')) throw new Error('QUALITY_NOT_SUPPORTED: 服务端尚不支持完整本地测试，请升级服务端；旧冒烟入口仍可使用。');
    return client.request(path, init);
  }
  const qualityReportSchema = smokeReportSchema.extend({ testRunRevision: z.number().int().min(0) }).strict();
  const qualitySelectionSchema = z.object({ libraryIds: z.array(z.string().min(1)).min(1), moduleIds: z.array(z.string()).optional(), priorities: z.array(z.enum(['P0', 'P1', 'P2', 'P3'])).optional(), tags: z.array(z.string()).optional(), targetKeys: z.array(z.string()).optional() }).strict();
  function qualityQuery(input: Record<string, string | number | undefined>) {
    return new URLSearchParams(Object.entries(input).filter((entry): entry is [string, string | number] => entry[1] !== undefined).map(([key, value]) => [key, String(value)])).toString();
  }
  server.registerTool('flowx_list_case_libraries', {
    title: '发现测试用例库', description: '查询有权限的工作区及项目用例库，返回 libraryId 供选例使用。',
    inputSchema: { workspaceId: z.string().min(1), projectId: z.string().min(1).optional() },
  }, async input => runRequest(() => qualityRequest(`/quality/case-libraries?${qualityQuery(input)}`)));
  server.registerTool('flowx_list_case_modules', {
    title: '发现用例库模块', description: '读取所选用例库的模块和层级，返回 moduleId；不修改正式用例库。',
    inputSchema: { libraryId: z.string().min(1) },
  }, async ({ libraryId }) => runRequest(() => qualityRequest(`/quality/case-libraries/${encodeURIComponent(libraryId)}/modules`)));
  server.registerTool('flowx_list_test_cases', {
    title: '检索正式测试用例', description: '按库、模块、优先级、关键词分页检索正式用例，读取步骤、测试数据和预期。用返回的 definition id 补选候选。',
    inputSchema: { workspaceId: z.string().min(1), projectId: z.string().min(1).optional(), libraryId: z.string().min(1).optional(), moduleId: z.string().min(1).optional(), priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(), q: z.string().optional(), page: z.number().int().min(1).optional(), pageSize: z.number().int().min(10).max(100).optional() },
  }, async input => runRequest(() => qualityRequest(`/quality/test-cases?${qualityQuery(input)}`)));
  server.registerTool('flowx_generate_test_design', {
    title: '生成需求测试设计', description: '在已明确用例库与范围后请求服务端生成候选设计。异步生成后读取最新设计；不会自动确认或开始测试。',
    inputSchema: { testDesignId: z.string().min(1) },
  }, async ({ testDesignId }) => runRequest(() => qualityRequest(`/quality/test-designs/${encodeURIComponent(testDesignId)}/generate`, { method: 'POST', body: '{}' })));
  server.registerTool('flowx_update_test_candidate', {
    title: '处理测试设计候选', description: '按用户决策修改候选动作、处理状态或用例草稿。使用最新 revision；处理候选不会确认整个设计，不能自行批量接受。proposedCase 只含 DTO 支持的可写字段。',
    inputSchema: {
      testDesignId: z.string().min(1), candidateId: z.string().min(1), revision: z.number().int().min(1),
      action: z.enum(['REUSE', 'OPTIMIZE', 'CREATE', 'EXCLUDE']).optional(),
      resolution: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional(),
      matchScore: z.number().optional(), decisionNote: z.string().optional(),
      proposedCase: z.object({ title: z.string().min(1), priority: z.string(), precondition: z.string().nullable().optional(), steps: z.array(z.string()), expected: z.string().min(1), tags: z.array(z.string()).optional(), testData: z.string().nullable().optional(), targetKeys: z.array(z.string()).optional() }).strict().optional(),
    },
  }, async ({ testDesignId, candidateId, ...body }) => runRequest(() => qualityRequest(`/quality/test-designs/${encodeURIComponent(testDesignId)}/candidates/${encodeURIComponent(candidateId)}`, { method: 'PATCH', body: JSON.stringify(body) })));
  server.registerTool('flowx_update_test_smoke', {
    title: '处理测试设计冒烟范围', description: '按用户决策整体替换未冻结设计的冒烟范围，使用最新 revision；服务端重新生成条目，id 不保证保留。cases 仅透传可写字段，剔除 sortOrder、时间戳、testDesignId 等只读数据；支持 precondition:null。不会自动确认设计，不能自行批量接受。无冒烟时明确传空 cases 和 noSmokeReason。',
    inputSchema: {
      testDesignId: z.string().min(1), revision: z.number().int().min(1),
      cases: z.array(z.object({ id: z.string().optional(), title: z.string().min(1), priority: z.string().optional(), precondition: z.string().nullable().optional(), steps: z.array(z.string()), expected: z.string().min(1), blocking: z.boolean(), coverageKeys: z.array(z.string()), resolution: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']) }).strip()),
      noSmokeReason: z.string().optional(),
    },
  }, async ({ testDesignId, ...body }) => runRequest(() => qualityRequest(`/quality/test-designs/${encodeURIComponent(testDesignId)}/smoke`, { method: 'PATCH', body: JSON.stringify(body) })));
  server.registerTool('flowx_confirm_test_design', {
    title: '确认需求测试设计', description: '仅在用户明确确认最终设计后调用。提交最新 revision、逐项覆盖检查及未覆盖项，冻结设计并复用服务端人工确认门禁；不会执行测试。',
    inputSchema: { testDesignId: z.string().min(1), revision: z.number().int().min(1), coverageChecks: z.array(z.object({ key: z.string().min(1), passed: z.boolean(), detail: z.string().optional() }).strict()), uncoveredItems: z.array(z.string()), noCaseReason: z.string().optional(), noSmokeReason: z.string().optional() },
  }, async ({ testDesignId, ...body }) => runRequest(() => qualityRequest(`/quality/test-designs/${encodeURIComponent(testDesignId)}/confirm`, { method: 'POST', body: JSON.stringify(body) })));
  server.registerTool('flowx_finish_test_run', {
    title: '结束本地测试轮次', description: '用户要求结束轮次且已无有效租约后，用最新 revision 结束轮次。服务端按实际逐例结果计算结论；结束不表示通过，未测项仍为阻塞。',
    inputSchema: { testRunId: z.string().min(1), revision: z.number().int().min(0), reason: z.string().optional() },
  }, async ({ testRunId, ...body }) => runRequest(() => qualityRequest(`/quality/test-runs/${encodeURIComponent(testRunId)}/finish`, { method: 'POST', body: JSON.stringify(body) })));
  server.registerTool('flowx_link_test_bug', {
    title: '关联失败测试与缺陷', description: '将本项目已有缺陷关联到指定测试用例结果；可在执行完成后补充，服务端校验项目、权限和结果，不改原始测试事实。',
    inputSchema: { testRunId: z.string().min(1), testRunCaseId: z.string().min(1), bugId: z.string().min(1) },
  }, async ({ testRunId, testRunCaseId, bugId }) => runRequest(() => qualityRequest(`/quality/test-runs/${encodeURIComponent(testRunId)}/cases/${encodeURIComponent(testRunCaseId)}/bug`, { method: 'POST', body: JSON.stringify({ bugId }) })));
  const createTestRequestSchema = z.object({
    workspaceId: z.string().min(1), projectId: z.string().min(1), projectVersionId: z.string().min(1), title: z.string().min(1), description: z.string().optional(),
    requirementIds: z.array(z.string()).min(1), workflowRunIds: z.array(z.string()).min(1), artifactIds: z.array(z.string()).optional(), testDesignId: z.string().optional(),
  }).strict();
  const testRequestActionSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('list'), projectId: z.string().min(1).optional(), projectVersionId: z.string().min(1).optional(), status: z.string().optional() }).strict(),
    z.object({ action: z.literal('get'), testRequestId: z.string().min(1) }).strict(),
    z.object({ action: z.literal('create'), request: createTestRequestSchema }).strict(),
    z.object({ action: z.literal('prepare'), testRequestId: z.string().min(1), scopeRevision: z.number().int().min(0) }).strict(),
  ]);
  server.registerTool('flowx_test_requests', {
    title: '查询、创建或准备提测单', description: 'list 按项目、版本和状态发现提测单；get 读取计划、快照和 scopeRevision；create 只按 request 创建，不自动准备；prepare 必须用户明确要求且传入最新 scopeRevision，由服务端检查设计、工作流和范围门禁。创建或准备不代表执行测试或测试通过。每个 action 只接受对应字段。',
    inputSchema: z.object({
      action: z.enum(['list', 'get', 'create', 'prepare']), testRequestId: z.string().min(1).optional(),
      projectId: z.string().min(1).optional(), projectVersionId: z.string().min(1).optional(), status: z.string().optional(),
      request: createTestRequestSchema.optional(), scopeRevision: z.number().int().min(0).optional(),
    }).strict(),
  }, async input => {
    const parsed = testRequestActionSchema.safeParse(input);
    if (!parsed.success) return textResult(`提测单动作参数无效：${parsed.error.message}`, true);
    const action = parsed.data;
    if (action.action === 'list') {
      const { action: _, ...filters } = action;
      const query = qualityQuery(filters);
      return runRequest(() => qualityRequest(`/quality/test-requests${query ? `?${query}` : ''}`));
    }
    if (action.action === 'get') return runRequest(() => qualityRequest(`/quality/test-requests/${encodeURIComponent(action.testRequestId)}`));
    if (action.action === 'create') return runRequest(() => qualityRequest('/quality/test-requests', { method: 'POST', body: JSON.stringify(action.request) }));
    return runRequest(() => qualityRequest(`/quality/test-requests/${encodeURIComponent(action.testRequestId)}/prepare`, { method: 'POST', body: JSON.stringify({ scopeRevision: action.scopeRevision }) }));
  });
  server.registerTool('flowx_create_test_run', {
    title: '创建本地功能测试或回归', description: '从就绪的测试计划创建功能初测或缺陷回归。必须明确用例适用端；回归需修复已完成的 sourceBugId。',
    inputSchema: { testRequestId: z.string().min(1), name: z.string().min(1), runType: z.enum(['INITIAL', 'REGRESSION']), sourceBugId: z.string().optional(), targets: z.array(smokeTargetSchema).min(1), cases: z.array(z.object({ snapshotId: z.string().min(1), targetKeys: z.array(z.string().min(1)).min(1) }).strict()).min(1) },
  }, async ({ testRequestId, ...body }) => runRequest(() => qualityRequest(`/quality/test-requests/${encodeURIComponent(testRequestId)}/local-test-runs`, { method: 'POST', body: JSON.stringify(body) })));
  server.registerTool('flowx_list_test_tasks', {
    title: '查询本地测试任务', description: '不传 testRunId 时发现有权限的活动测试任务；传入时读取待测快照、目标端、代码基线和领取状态。',
    inputSchema: { testRunId: z.string().optional(), projectId: z.string().optional(), projectVersionId: z.string().optional(), testRequestId: z.string().optional() },
  }, async ({ testRunId, ...filters }) => runRequest(() => qualityRequest(testRunId ? `/quality/test-runs/${encodeURIComponent(testRunId)}/tasks` : `/quality/local-test-tasks?${new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined))}`)));
  server.registerTool('flowx_claim_test_task', {
    title: '领取本地测试用例', description: '领取指定目标端与用例，返回会话、稳定任务版本、租约和代码基线。只执行本次实际领取范围。',
    inputSchema: { testRunId: z.string().min(1), targetId: z.string().min(1), caseIds: z.array(z.string()).optional(), deviceId: z.string().optional(), leaseSeconds: z.number().int().min(60).max(86400).optional() },
  }, async ({ testRunId, ...body }) => runRequest(() => qualityRequest(`/quality/test-runs/${encodeURIComponent(testRunId)}/claim`, { method: 'POST', body: JSON.stringify(body) })));
  for (const [name, action, title] of [
    ['flowx_report_test_progress', 'progress', '分批回传实际测试结果'],
    ['flowx_submit_test_report', 'complete', '完成本地测试会话'],
  ] as const) server.registerTool(name, {
    title, description: '在领取的代码版本上真实执行后回传逐例结果和已上传证据。使用稳定幂等键；同键不能改变内容，失败也是有效测试结论。complete 要求所有领取项已有结果。',
    inputSchema: { executionSessionId: z.string().min(1), report: qualityReportSchema },
  }, async ({ executionSessionId, report }) => runRequest(() => qualityRequest(`/execution-sessions/${encodeURIComponent(executionSessionId)}/quality/${action}`, { method: 'POST', body: JSON.stringify(report) })));
  server.registerTool('flowx_control_test_execution', {
    title: '续租、释放或取消本地测试', description: '原领取人续租或在设备停止后释放/取消未完成范围。服务端取消不会停止设备进程，已过期租约不能复活。',
    inputSchema: { executionSessionId: z.string().min(1), action: z.enum(['heartbeat', 'release', 'cancel']), leaseSeconds: z.number().int().min(60).max(86400).optional(), reason: z.string().optional() },
  }, async ({ executionSessionId, action, ...body }) => runRequest(() => qualityRequest(`/execution-sessions/${encodeURIComponent(executionSessionId)}/quality/${action}`, { method: 'POST', body: JSON.stringify(body) })));
  server.registerTool('flowx_create_test_design', {
    title: '准备需求测试设计', description: '从已确认 Spec & Plan 的需求准备测试设计，明确指定用例库；不会自动确认设计或开始测试。',
    inputSchema: { workspaceId: z.string().min(1), projectId: z.string().min(1), projectVersionId: z.string().min(1), requirementIds: z.array(z.string()).min(1), workflowRunIds: z.array(z.string()).min(1), caseSelection: qualitySelectionSchema.optional(), changeSummary: z.string().optional() },
  }, async body => runRequest(() => qualityRequest('/quality/test-designs', { method: 'POST', body: JSON.stringify(body) })));
  server.registerTool('flowx_get_test_design', {
    title: '读取测试设计与范围', description: '查询用例候选、选例范围、未覆盖项和最新 revision，不自动生成或确认。', inputSchema: { testDesignId: z.string().min(1) },
  }, async ({ testDesignId }) => runRequest(() => qualityRequest(`/quality/test-designs/${encodeURIComponent(testDesignId)}`)));
  server.registerTool('flowx_update_test_selection', {
    title: '选择需求用例库与模块', description: '修改未冻结设计的选例范围，清除旧候选并等待重新生成。使用当前 revision。', inputSchema: { testDesignId: z.string().min(1), revision: z.number().int().min(1), caseSelection: qualitySelectionSchema },
  }, async ({ testDesignId, ...body }) => runRequest(() => qualityRequest(`/quality/test-designs/${encodeURIComponent(testDesignId)}/selection`, { method: 'PATCH', body: JSON.stringify(body) })));
  server.registerTool('flowx_add_test_candidates', {
    title: '手工补选已有测试用例', description: '将所选库中已有用例按原内容纳入当前设计。不会修改正式用例定义，不受 AI 输入截断限制。', inputSchema: { testDesignId: z.string().min(1), revision: z.number().int().min(1), definitionIds: z.array(z.string()).min(1) },
  }, async ({ testDesignId, ...body }) => runRequest(() => qualityRequest(`/quality/test-designs/${encodeURIComponent(testDesignId)}/candidates`, { method: 'POST', body: JSON.stringify(body) })));
  server.registerTool('flowx_test_reports', {
    title: '读取或生成测试报告', description: 'list 查询历史报告；run 生成本轮报告；request 以明确 runIds、baseline 和可选 supersessions 汇总提测报告。失败和阻塞可生成报告；FINAL 要求轮次已结束。不会把测试标记为通过。',
    inputSchema: { action: z.enum(['list', 'run', 'request']), testRequestId: z.string().min(1).optional(), testRunId: z.string().min(1).optional(), idempotencyKey: z.string().min(1).optional(), mode: z.enum(['PROGRESS', 'FINAL']).optional(), runIds: z.array(z.string().min(1)).min(1).optional(), baseline: z.array(z.object({ workflowRepositoryId: z.string().min(1), branch: z.string().min(1), headSha: z.string().min(1) }).strict()).min(1).optional(), supersessions: z.array(z.object({ previousRunId: z.string().min(1), regressionRunId: z.string().min(1), testRunCaseIds: z.array(z.string().min(1)).min(1) }).strict()).optional() },
  }, async input => {
    if (input.action === 'list' && input.testRequestId) return runRequest(() => qualityRequest(`/quality/test-requests/${encodeURIComponent(input.testRequestId!)}/reports`));
    if (input.action === 'run' && input.testRunId && input.idempotencyKey && input.mode) return runRequest(() => qualityRequest(`/quality/test-runs/${encodeURIComponent(input.testRunId!)}/reports`, { method: 'POST', body: JSON.stringify({ idempotencyKey: input.idempotencyKey, mode: input.mode }) }));
    if (input.action === 'request' && input.testRequestId && input.idempotencyKey && input.mode && input.runIds && input.baseline) return runRequest(() => qualityRequest(`/quality/test-requests/${encodeURIComponent(input.testRequestId!)}/reports`, { method: 'POST', body: JSON.stringify({ idempotencyKey: input.idempotencyKey, mode: input.mode, runIds: input.runIds, baseline: input.baseline, ...(input.supersessions ? { supersessions: input.supersessions } : {}) }) }));
    return textResult('请提供对应动作的标识和参数：报告生成需 idempotencyKey、mode；汇总另需 runIds、baseline。', true);
  });

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
        'Create a requirement on FlowX only after the user explicitly asked to create/register the item in FlowX or confirmed that choice. Never interpret ordinary code changes, current-project feature work, or requirement discussion as authorization to create FlowX data. Requires projectId and title; description, acceptanceCriteria, priority, functionalModule, riskImpact, productRequirementDocument and remark are optional. Omit priority to keep the server default MEDIUM. Confirm the release version with the user first and pass a valid versionId; if omitted the server uses the project current version. A version is required and null is rejected.',
      inputSchema: z.object({
        projectId: z.string().min(1),
        title: z.string().trim().min(1),
        description: z.string().optional(),
        acceptanceCriteria: z.string().optional(),
        priority: requirementPrioritySchema.optional(),
        functionalModule: z.string().optional(),
        riskImpact: z.string().optional(),
        productRequirementDocument: z.string().optional(),
        remark: z.string().optional(),
        repositoryIds: z.array(z.string()).optional(),
        versionId: z.string().min(1).optional(),
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
            ...requirementProfileBody(input),
            ...(input.repositoryIds?.length ? { repositoryIds: input.repositoryIds } : {}),
            ...(input.versionId !== undefined ? { versionId: input.versionId } : {}),
          }),
        }),
      );
    },
  );

  server.registerTool(
    'flowx_update_requirement',
    {
      title: 'Update FlowX Requirement',
      description:
        'Update an existing FlowX requirement only after the user explicitly asked to edit it. Send only the fields the user wants to change. Creator and created time stay unchanged. Does not start or restart a workflow.',
      inputSchema: z.object({
        requirementId: z.string().min(1),
        title: z.string().trim().min(1).optional(),
        description: z.string().optional(),
        acceptanceCriteria: z.string().optional(),
        priority: requirementPrioritySchema.optional(),
        functionalModule: z.string().optional(),
        riskImpact: z.string().optional(),
        productRequirementDocument: z.string().optional(),
        remark: z.string().optional(),
        versionId: z.string().min(1).optional(),
      }),
    },
    async (input) => {
      const { requirementId, versionId, ...profile } = input;
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() =>
        client.request(`/requirements/${encodeURIComponent(requirementId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...(profile.title !== undefined ? { title: profile.title } : {}),
            ...(profile.description !== undefined ? { description: profile.description } : {}),
            ...(profile.acceptanceCriteria !== undefined ? { acceptanceCriteria: profile.acceptanceCriteria } : {}),
            ...requirementProfileBody(profile),
            ...(versionId !== undefined ? { versionId } : {}),
          }),
        }),
      );
    },
  );

  server.registerTool(
    'flowx_delete_requirement',
    {
      title: 'Delete FlowX Requirement',
      description:
        'Delete a FlowX requirement only after showing the user that workflows, ideation, schedule and prototype materials will be removed, while linked bugs and issues stay unlinked. Pass userConfirmedDelete=true only after explicit confirmation. The server rejects deletion while a stage is still running or the requirement is already in test design or a test request.',
      inputSchema: z.object({
        requirementId: z.string().min(1),
        userConfirmedDelete: z.boolean(),
      }),
    },
    async (input) => {
      if (input.userConfirmedDelete !== true) {
        return textResult(
          'Refusing to delete requirement: userConfirmedDelete must be true after the user explicitly confirmed deletion.',
          true,
        );
      }
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() =>
        client.request(`/requirements/${encodeURIComponent(input.requirementId)}`, { method: 'DELETE' }),
      );
    },
  );

  server.registerTool(
    'flowx_submit_requirement_change',
    {
      title: 'Submit FlowX Requirement Change',
      description:
        'Record a formal requirement change only after the user confirmed the exact text and mode. SUPPLEMENT keeps the current workflow and is included in later handoffs. RESTART starts a new round and keeps old outputs. Pass userConfirmedChange=true only after that confirmation. Reuse the same requestId when retrying the identical submission.',
      inputSchema: z.object({
        requirementId: z.string().min(1),
        content: z.string().trim().min(1).max(20000),
        mode: z.enum(['SUPPLEMENT', 'RESTART']),
        requestId: z.string().trim().min(1).max(128),
        sourceWorkflowRunId: z.string().min(1).optional(),
        userConfirmedChange: z.boolean(),
      }),
    },
    async (input) => {
      if (input.userConfirmedChange !== true) {
        return textResult(
          'Refusing to submit requirement change: userConfirmedChange must be true after the user explicitly confirmed the text and mode.',
          true,
        );
      }
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() =>
        client.request(`/requirements/${encodeURIComponent(input.requirementId)}/changes`, {
          method: 'POST',
          body: JSON.stringify({
            content: input.content,
            mode: input.mode,
            requestId: input.requestId,
            ...(input.sourceWorkflowRunId ? { sourceWorkflowRunId: input.sourceWorkflowRunId } : {}),
          }),
        }),
      );
    },
  );

  server.registerTool(
    'flowx_retry_requirement_change',
    {
      title: 'Retry FlowX Requirement Change',
      description:
        'Continue a requirement change whose new workflow is still pending or failed. Use this after the user ended the blocking task or asked to retry. Pass userConfirmedRetry=true only after explicit confirmation. Does not create another change.',
      inputSchema: z.object({
        requirementId: z.string().min(1),
        changeId: z.string().min(1),
        userConfirmedRetry: z.boolean(),
      }),
    },
    async (input) => {
      if (input.userConfirmedRetry !== true) {
        return textResult(
          'Refusing to retry requirement change: userConfirmedRetry must be true after the user explicitly confirmed.',
          true,
        );
      }
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() =>
        client.request(
          `/requirements/${encodeURIComponent(input.requirementId)}/changes/${encodeURIComponent(input.changeId)}/restart`,
          { method: 'POST' },
        ),
      );
    },
  );

  server.registerTool(
    'flowx_submit_requirement_prototype_change',
    {
      title: 'Submit FlowX Prototype Change',
      description:
        'Replace the prototype for a requirement change and restart the workflow. Only after the user confirmed a local .zip path of at most 20 MiB. Content may be omitted. Pass userConfirmedChange=true only after that confirmation. Reuse the same requestId when retrying the identical package.',
      inputSchema: z.object({
        requirementId: z.string().min(1),
        zipPath: z.string().min(1),
        requestId: z.string().trim().min(1).max(128),
        content: z.string().max(20000).optional(),
        aiProvider: z.enum(['codex', 'cursor']).optional(),
        sourceWorkflowRunId: z.string().min(1).optional(),
        userConfirmedChange: z.boolean(),
      }),
    },
    async (input) => {
      if (input.userConfirmedChange !== true) {
        return textResult(
          'Refusing to submit prototype change: userConfirmedChange must be true after the user explicitly confirmed the zip and restart.',
          true,
        );
      }
      const filePath = resolve(input.zipPath);
      const info = await stat(filePath).catch(() => null);
      if (!info?.isFile() || !filePath.toLowerCase().endsWith('.zip') || info.size > 20 * 1024 * 1024 || info.size < 1) {
        return textResult('请提供不超过 20 MiB 的本地 .zip 原型包路径。', true);
      }
      const bytes = await readFile(filePath);
      const body = new Uint8Array(bytes.byteLength);
      body.set(bytes);
      const form = new FormData();
      form.append('file', new Blob([body], { type: 'application/zip' }), basename(filePath));
      form.append('mode', 'RESTART');
      form.append('requestId', input.requestId);
      if (input.content?.trim()) form.append('content', input.content.trim());
      if (input.aiProvider) form.append('aiProvider', input.aiProvider);
      if (input.sourceWorkflowRunId) form.append('sourceWorkflowRunId', input.sourceWorkflowRunId);
      const { client } = await resolveSession(options.homeDir);
      return runRequest(() =>
        client.requestForm(`/requirements/${encodeURIComponent(input.requirementId)}/changes/prototype`, form),
      );
    },
  );

  server.registerTool(
    'flowx_start_workflow',
    {
      title: 'Start FlowX Workflow',
      description:
        'Start a workflow for an existing requirement after showing the user a start summary and receiving explicit confirmation. Always pass userConfirmedStart=true only after that confirmation. Then follow flowx-continue: call flowx_get_workflow_position and let the user choose their own skill or a FlowX skill for the current stage.',
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
    'flowx_get_workflow_position',
    {
      title: 'Get FlowX Workflow Position',
      description:
        'Read the live FlowX workflow position before generating or submitting. Returns server status, localAction, the current stage, prior submitted outputs, and outputContract. Do not infer the stage from local files, chat history, or another person\'s machine.',
      inputSchema: z.object({
        workflowRunId: z.string().optional(),
        workspaceId: z.string().optional(),
      }),
    },
    async ({ workflowRunId, workspaceId }) => {
      const { client } = await resolveSession(options.homeDir);
      const params = new URLSearchParams();
      if (workflowRunId?.trim()) params.set('workflowRunId', workflowRunId.trim());
      if (workspaceId?.trim()) params.set('workspaceId', workspaceId.trim());
      const query = params.toString();
      return runRequest(() =>
        client.request(`/cursor-local/workflow-position${query ? `?${query}` : ''}`),
      );
    },
  );

  server.registerTool(
    'flowx_list_tasks',
    {
      title: 'List FlowX Tasks',
      description:
        'List FlowX requirements/bugs and OpenDesign brainstorm/design candidate workflows. Optional projectId, versionId, planningStatus and priority filter the task list. versionId and planningStatus apply to requirements only and omit bugs. OpenDesign candidates are not filtered. Confirm a workflow with the user, then call flowx_bind_workflow.',
      inputSchema: z.object({
        workspaceId: z.string().optional(),
        projectId: z.string().optional(),
        versionId: z.string().optional(),
        planningStatus: z.enum(['UNSCHEDULED', 'SCHEDULED', 'IN_PROGRESS', 'DONE']).optional(),
        priority: requirementPrioritySchema.optional(),
      }),
    },
    async ({ workspaceId, projectId, versionId, planningStatus, priority }) => {
      const { client } = await resolveSession(options.homeDir);
      const params = new URLSearchParams();
      if (workspaceId?.trim()) params.set('workspaceId', workspaceId.trim());
      if (projectId?.trim()) params.set('projectId', projectId.trim());
      if (versionId?.trim()) params.set('versionId', versionId.trim());
      if (planningStatus) params.set('planningStatus', planningStatus);
      if (priority) params.set('priority', priority);
      const query = params.toString();
      const openDesignParams = new URLSearchParams();
      if (workspaceId?.trim()) openDesignParams.set('workspaceId', workspaceId.trim());
      const openDesignQuery = openDesignParams.toString();
      return runRequest(async () => {
        const [tasks, openDesignWorkflows] = await Promise.all([
          client.request(`/cursor-local/tasks${query ? `?${query}` : ''}`),
          client.request(`/cursor-local/opendesign-tasks${openDesignQuery ? `?${openDesignQuery}` : ''}`),
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
      inputSchema: z.object({ cwd: z.string().optional(), baseBranch: z.string().min(1).optional() }),
    },
    async ({ cwd, baseBranch }) => textResult(await collectGitReport(cwd?.trim() || process.cwd(), baseBranch)),
  );

  server.registerTool(
    'flowx_execution_checkpoint',
    {
      title: '检查 FlowX 执行状态',
      description: '本地开发开始、操作前后及等待期间每 30 秒调用。有实质进展时用 progressSummary 回报已完成什么、正在做什么；普通保活可省略。获取控制命令；取消命令必须先停止本任务操作，再单独确认。该工具不会终止 IDE。',
      inputSchema: z.object({ executionSessionId: z.string().min(1), blockedReason: z.string().trim().min(1).max(2000).optional(), progressSummary: z.string().trim().min(1).max(2000).optional() }),
    },
    async ({ executionSessionId, blockedReason, progressSummary }) => runRequest(async () => {
      const { client } = await resolveSession(options.homeDir);
      const { deviceId } = ensureDeviceIdentity({ homeDir: options.homeDir });
      const result = await client.request(`/execution-sessions/${encodeURIComponent(executionSessionId)}/checkpoint`, {
        method: 'POST', body: JSON.stringify({ deviceId, blockedReason, progressSummary }),
      }) as ExecutionCheckpointResult;
      return { ...result, instructions: [
        'CANCEL：停止本任务的修改和命令，确认本任务启动的操作已停止后回执 ACKED；无法停止回执 FAILED，禁止提交完成。',
        'RESUME：重新读取平台状态和上下文，确认可继续后回执 ACKED；不要恢复已取消的会话。',
        'REQUEST_SYNC：执行 flowx-local sync 并核对本任务待同步结果，全部成功后回执 ACKED；仍有失败则回执 FAILED。',
        '平台不可达时保留本地产物；恢复连接后先读取检查点再继续。',
      ] };
    }),
  );

  server.registerTool(
    'flowx_ack_execution_command',
    {
      title: '回执 FlowX 控制命令',
      description: '仅在实际处理命令之后回执。CANCEL 的 ACKED 表示本任务操作已停止；工具本身不会停止任何进程。请求失败时必须重试同一 commandId。',
      inputSchema: z.object({ executionSessionId: z.string().min(1), commandId: z.string().min(1), outcome: z.enum(['ACKED', 'FAILED']), message: z.string().max(2000).optional() }),
    },
    async ({ executionSessionId, commandId, outcome, message }) => runRequest(async () => {
      const { client } = await resolveSession(options.homeDir);
      const { deviceId } = ensureDeviceIdentity({ homeDir: options.homeDir });
      return client.request(`/execution-sessions/${encodeURIComponent(executionSessionId)}/commands/${encodeURIComponent(commandId)}/ack`, {
        method: 'POST', body: JSON.stringify({ deviceId, outcome, message }),
      });
    }),
  );

  server.registerTool(
    'flowx_report_completion',
    {
      title: 'Report FlowX Completion',
      description: 'Collect local Git state and report completion. Use executionSessionId from the handoff; controlled sessions must check pending commands before submitting.',
      inputSchema: z.object({
        workflowRunId: z.string(),
        workflowRepositoryId: z.string(),
        executionSessionId: z.string().min(1).optional(),
        implementationSummary: z.string(),
        testResult: z.string(),
        pushed: z.boolean(),
        cwd: z.string().optional(),
      }),
    },
    async (input) => runRequest(async () => {
      const { client } = await resolveSession(options.homeDir);
      if (input.executionSessionId) {
        const { deviceId } = ensureDeviceIdentity({ homeDir: options.homeDir });
        const checkpoint = await client.request(`/execution-sessions/${encodeURIComponent(input.executionSessionId)}/checkpoint`, {
          method: 'POST', body: JSON.stringify({ deviceId }),
        }) as ExecutionCheckpointResult;
        if (checkpoint.session.workflowRunId !== input.workflowRunId) throw new Error('会话不属于当前工作流。');
        if (checkpoint.session.cancelRequestedAt || checkpoint.commands.length ||
          !['RUNNING', 'COMPLETED'].includes(checkpoint.session.status)) {
          throw new Error('请先处理检查点中的控制命令或阻塞状态，再提交完成。');
        }
      }
      const workflow = await client.request(`/workflow-runs/${encodeURIComponent(input.workflowRunId)}`) as {
        workflowRepositories: Array<{ id: string; baseBranch: string; workingBranch: string }>;
      };
      const repository = workflow.workflowRepositories.find((item) => item.id === input.workflowRepositoryId);
      if (!repository) throw new Error('仓库不属于当前工作流。');
      const report = await collectGitReport(input.cwd?.trim() || process.cwd(), repository.baseBranch);
      if (report.branch !== repository.workingBranch) throw new Error('当前分支与交接工作分支不一致，请核对后提交。');
      if (report.changedFiles.length === 0) throw new Error('相对任务基线没有已提交变更，请先核对提交和基线。');
      return client.request(input.executionSessionId
        ? `/execution-sessions/${encodeURIComponent(input.executionSessionId)}/complete`
        : `/workflow-runs/${encodeURIComponent(input.workflowRunId)}/execution/complete-local`, {
        method: 'POST',
        body: JSON.stringify({
          pushed: input.pushed,
          implementationSummary: input.implementationSummary,
          testResult: input.testResult,
          diffSummary: report.diffSummary,
          untrackedFiles: report.untrackedFiles,
          repositories: [{ workflowRepositoryId: input.workflowRepositoryId, headSha: report.headSha,
            changedFiles: report.changedFiles, patchSummary: input.implementationSummary }],
        }),
      });
    }),
  );

  return server;
}

export async function runLocalMcp() {
  const server = createLocalMcpServer();
  await server.connect(new StdioServerTransport());
}
