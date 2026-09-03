import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readActiveDesignSession } from './active-design-session.js';
import {
  FlowXApiClient,
  type BrainstormCompletionReportInput,
  type DesignCompletionReportInput,
  type RegisterEvidenceInput,
} from './flowx-api-client.js';
import { collectGitReport as defaultCollectGitReport } from './git-report.js';

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: 'text'; text: string }>;
};

type GitReport = Awaited<ReturnType<typeof defaultCollectGitReport>>;

export interface FlowXToolDependencies {
  apiClient: FlowXApiClient;
  collectGitReport: (cwd: string) => Promise<GitReport>;
  readActiveDesignSession?: typeof readActiveDesignSession;
  resolveDesignClient?: () => Promise<FlowXApiClient>;
}

function textResult(value: unknown, isError = false): ToolResult {
  return {
    ...(isError ? { isError: true } : {}),
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
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

const evidenceTypeSchema = z.enum([
  'GIT_COMMIT',
  'REMOTE_BRANCH_VERIFICATION',
  'CHANGED_FILES',
  'TEST_RESULT',
  'BUILD_RESULT',
  'USER_CONFIRMATION',
  'AGENT_SUMMARY',
]);

function buildIdempotencyKey(prefix: string, executionSessionId: string) {
  return `${prefix}:${executionSessionId}:${crypto.randomUUID()}`;
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
        z
          .object({
            id: z.string().min(1),
            pages: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    title: z.string().optional(),
                    html: z.string().min(1),
                  })
                  .passthrough(),
              )
              .min(1),
          })
          .passthrough(),
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

export function createFlowXToolHandlers(deps: FlowXToolDependencies) {
  const loadActive = deps.readActiveDesignSession ?? readActiveDesignSession;
  const resolveDesignClient =
    deps.resolveDesignClient ?? (() => FlowXApiClient.forDesignTools());

  return {
    async flowx_list_projects() {
      return textResult(summarizeProjects(await deps.apiClient.listProjects()));
    },

    async flowx_create_requirement(input: {
      projectId: string;
      title: string;
      description: string;
      acceptanceCriteria: string;
      repositoryIds?: string[];
      versionId?: string | null;
    }) {
      return textResult(
        await deps.apiClient.createRequirement({
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          acceptanceCriteria: input.acceptanceCriteria,
          ...(input.repositoryIds?.length ? { repositoryIds: input.repositoryIds } : {}),
          ...(input.versionId !== undefined ? { versionId: input.versionId } : {}),
        }),
      );
    },

    async flowx_create_project_version(input: {
      projectId: string;
      name: string;
      setAsCurrent?: boolean;
    }) {
      const created = await deps.apiClient.createProjectVersion(input.projectId, { name: input.name });
      if (input.setAsCurrent === true && created && typeof created === 'object' && 'id' in created) {
        await deps.apiClient.setProjectCurrentVersion(input.projectId, (created as { id: string }).id);
      }
      return textResult(created);
    },

    async flowx_start_workflow(input: {
      requirementId: string;
      userConfirmedStart: boolean;
      repositoryIds?: string[];
      aiProvider?: 'codex' | 'cursor';
    }) {
      if (input.userConfirmedStart !== true) {
        return textResult(
          'Refusing to start workflow: userConfirmedStart must be true after the user explicitly confirmed the start summary.',
          true,
        );
      }
      return textResult(
        await deps.apiClient.createWorkflowRun({
          requirementId: input.requirementId,
          ...(input.repositoryIds?.length ? { repositoryIds: input.repositoryIds } : {}),
          ...(input.aiProvider ? { aiProvider: input.aiProvider } : {}),
        }),
      );
    },

    async flowx_list_tasks(input: { workspaceId?: string }) {
      return textResult(await deps.apiClient.listTasks(input.workspaceId));
    },

    async flowx_get_task_context(input: { type: 'requirement' | 'bug'; id: string }) {
      return textResult(await deps.apiClient.getTaskContext(input.type, input.id));
    },

    async flowx_collect_git_report(input: { cwd?: string }) {
      return textResult(await deps.collectGitReport(input.cwd?.trim() || process.cwd()));
    },

    async flowx_report_completion(input: {
      workflowRunId: string;
      workflowRepositoryId: string;
      executionSessionId?: string;
      idempotencyKey?: string;
      implementationSummary: string;
      testResult: string;
      pushed: boolean;
      cwd?: string;
    }) {
      const report = await deps.collectGitReport(input.cwd?.trim() || process.cwd());
      if (report.changedFiles.length === 0) {
        return textResult(
          'No changed files were found. Confirm the working tree before reporting completion.',
          true,
        );
      }

      const completion = {
        pushed: input.pushed,
        implementationSummary: input.implementationSummary,
        testResult: input.testResult,
        diffSummary: report.diffSummary,
        untrackedFiles: report.untrackedFiles,
        repositories: [
          {
            workflowRepositoryId: input.workflowRepositoryId,
            headSha: report.headSha,
            changedFiles: report.changedFiles,
            patchSummary: input.implementationSummary,
          },
        ],
      };
      const executionSessionId = input.executionSessionId?.trim();
      if (executionSessionId) {
        const result = await deps.apiClient.completeExecutionSession(executionSessionId, {
          idempotencyKey:
            input.idempotencyKey?.trim() ||
            `local:${executionSessionId}:${report.headSha}`,
          ...completion,
        });
        return textResult(result);
      }

      const result = await deps.apiClient.completeLocal(input.workflowRunId, completion);
      return textResult({
        warning:
          'executionSessionId was not provided; used the legacy completion API. Obtain the session id from the FlowX task prompt for future reports.',
        result,
      });
    },

    async flowx_report_progress(input: {
      executionSessionId: string;
      message: string;
      idempotencyKey?: string;
    }) {
      const executionSessionId = input.executionSessionId.trim();
      const idempotencyKey =
        input.idempotencyKey?.trim() || buildIdempotencyKey('progress', executionSessionId);
      return textResult(
        await deps.apiClient.appendExecutionEvent(executionSessionId, {
          eventId: idempotencyKey,
          schemaVersion: '1.0',
          sourceTool: 'cursor',
          traceId: executionSessionId,
          entityType: 'execution_session',
          entityId: executionSessionId,
          eventType: 'execution.progressed',
          payload: { message: input.message },
          occurredAt: new Date().toISOString(),
          idempotencyKey,
        }),
      );
    },

    async flowx_report_evidence(input: {
      executionSessionId: string;
      evidenceType: RegisterEvidenceInput['evidenceType'];
      summary: string;
      idempotencyKey?: string;
    }) {
      const idempotencyKey = input.idempotencyKey?.trim();
      return textResult(
        await deps.apiClient.registerEvidence(input.executionSessionId.trim(), {
          evidenceType: input.evidenceType,
          sourceTool: 'cursor',
          title: input.summary,
          summary: input.summary,
          ...(idempotencyKey ? { metadata: { idempotencyKey } } : {}),
        }),
      );
    },

    async flowx_get_active_design_session(_input: { refresh?: boolean } = {}) {
      const active = await loadActive();
      if (!active) {
        return textResult(
          'No active OpenDesign session. In FlowX, click “打开本地 OpenDesign” while flowx-local is running, then retry.',
          true,
        );
      }
      const expired =
        Number.isFinite(Date.parse(active.accessTokenExpiresAt)) &&
        Date.parse(active.accessTokenExpiresAt) <= Date.now();
      const stage = active.stage ?? 'design';
      return textResult({
        workflowRunId: active.workflowRunId,
        executionSessionId: active.executionSessionId,
        apiBaseUrl: active.apiBaseUrl,
        accessTokenExpiresAt: active.accessTokenExpiresAt,
        accessTokenExpired: expired,
        stage,
        updatedAt: active.updatedAt,
        nextSteps: expired
          ? [
              'Short-lived token expired. Re-click “打开本地 OpenDesign” in FlowX, then retry MCP tools.',
            ]
          : stage === 'brainstorm'
            ? [
                'Call flowx_get_brainstorm_handoff (omit workflowRunId to use this active session).',
                'Brainstorm with the user to clarify product requirements, write prd.md, and show it for confirmation.',
                'Only after the user confirms, call flowx_submit_brainstorm with { idempotencyKey, markdown }.',
              ]
            : [
                'Call flowx_get_design_handoff (omit workflowRunId to use this active session).',
                'Design in the Open Design project directory you chose.',
                'Call flowx_submit_design with a DesignCompletionReport including surfaces[{ id, pages[{ id, html }] }].',
              ],
      });
    },

    async flowx_get_design_handoff(input: { workflowRunId?: string }) {
      let workflowRunId = input.workflowRunId?.trim() ?? '';
      if (!workflowRunId) {
        const active = await loadActive();
        workflowRunId = active?.workflowRunId ?? '';
      }
      if (!workflowRunId) {
        return textResult(
          'workflowRunId is required when there is no active design session on this machine.',
          true,
        );
      }
      try {
        const client = await resolveDesignClient();
        return textResult(await client.getDesignHandoff(workflowRunId));
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), true);
      }
    },

    async flowx_get_brainstorm_handoff(input: { workflowRunId?: string }) {
      let workflowRunId = input.workflowRunId?.trim() ?? '';
      if (!workflowRunId) {
        const active = await loadActive();
        workflowRunId = active?.workflowRunId ?? '';
      }
      if (!workflowRunId) {
        return textResult(
          'workflowRunId is required when there is no active brainstorm session on this machine.',
          true,
        );
      }
      try {
        const client = await resolveDesignClient();
        return textResult(await client.getBrainstormHandoff(workflowRunId));
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), true);
      }
    },

    async flowx_submit_design(input: {
      executionSessionId?: string;
      report: DesignCompletionReportInput;
    }) {
      let executionSessionId = input.executionSessionId?.trim() ?? '';
      if (!executionSessionId) {
        const active = await loadActive();
        executionSessionId = active?.executionSessionId ?? '';
      }
      if (!executionSessionId) {
        return textResult(
          'executionSessionId is required when there is no active design session on this machine.',
          true,
        );
      }
      const parsed = designReportSchema.safeParse(input.report);
      if (!parsed.success) {
        return textResult(`Invalid design report: ${parsed.error.message}`, true);
      }
      if (
        !parsed.data.output.surfaces.some((surface) =>
          surface.pages.some((page) => page.html.includes('<')),
        )
      ) {
        return textResult('surfaces[].pages[].html must include complete HTML documents.', true);
      }
      try {
        const client = await resolveDesignClient();
        return textResult(await client.submitDesign(executionSessionId, parsed.data));
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), true);
      }
    },

    async flowx_submit_brainstorm(input: {
      executionSessionId?: string;
      report: BrainstormCompletionReportInput;
    }) {
      let executionSessionId = input.executionSessionId?.trim() ?? '';
      if (!executionSessionId) {
        const active = await loadActive();
        executionSessionId = active?.executionSessionId ?? '';
      }
      if (!executionSessionId) {
        return textResult(
          'executionSessionId is required when there is no active brainstorm session on this machine.',
          true,
        );
      }
      const parsed = brainstormReportSchema.safeParse(input.report);
      if (!parsed.success) {
        return textResult(`Invalid brainstorm report: ${parsed.error.message}`, true);
      }
      try {
        const client = await resolveDesignClient();
        return textResult(await client.submitBrainstorm(executionSessionId, parsed.data));
      } catch (error) {
        return textResult(error instanceof Error ? error.message : String(error), true);
      }
    },
  };
}

export function registerFlowXTools(
  server: McpServer,
  deps: FlowXToolDependencies = {
    apiClient: new FlowXApiClient(),
    collectGitReport: defaultCollectGitReport,
  },
) {
  const handlers = createFlowXToolHandlers(deps);

  server.registerTool(
    'flowx_list_projects',
    {
      title: 'List FlowX Projects',
      description:
        'List workspaces/projects for FlowX requirement intake only after the user explicitly asked to create/register the item in FlowX or confirmed that choice. Do not use for ordinary code changes, current-project feature work, or requirement discussion. If intent is unclear, ask whether to handle it in the current project or register it in FlowX before calling any FlowX tool. Ask the user to pick a projectId; do not infer from local repo paths.',
      inputSchema: z.object({}),
    },
    handlers.flowx_list_projects,
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
    handlers.flowx_create_project_version,
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
    handlers.flowx_create_requirement,
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
    handlers.flowx_start_workflow,
  );
  server.registerTool(
    'flowx_list_tasks',
    {
      title: 'List FlowX Tasks',
      description: 'List FlowX requirements and bugs eligible for local Cursor development.',
      inputSchema: z.object({ workspaceId: z.string().optional() }),
    },
    handlers.flowx_list_tasks,
  );
  server.registerTool(
    'flowx_get_task_context',
    {
      title: 'Get FlowX Task Context',
      description: 'Read raw FlowX requirement or bug context.',
      inputSchema: z.object({
        type: z.enum(['requirement', 'bug']),
        id: z.string(),
      }),
    },
    handlers.flowx_get_task_context,
  );
  server.registerTool(
    'flowx_collect_git_report',
    {
      title: 'Collect Git Report',
      description: 'Collect current branch, HEAD, changed files, untracked files, and diff summary.',
      inputSchema: z.object({ cwd: z.string().optional() }),
    },
    handlers.flowx_collect_git_report,
  );
  server.registerTool(
    'flowx_report_completion',
    {
      title: 'Report FlowX Completion',
      description:
        'Collect local Git state and report completion through an ExecutionSession when its id is available.',
      inputSchema: z.object({
        workflowRunId: z.string(),
        workflowRepositoryId: z.string(),
        executionSessionId: z
          .string()
          .optional()
          .describe('Prefer the execution session id supplied in the FlowX task prompt.'),
        idempotencyKey: z.string().optional(),
        implementationSummary: z.string(),
        testResult: z.string(),
        pushed: z.boolean(),
        cwd: z.string().optional(),
      }),
    },
    handlers.flowx_report_completion,
  );
  server.registerTool(
    'flowx_report_progress',
    {
      title: 'Report FlowX Progress',
      description: 'Append an execution.progressed event to an ExecutionSession.',
      inputSchema: z.object({
        executionSessionId: z.string(),
        message: z.string().min(1),
        idempotencyKey: z.string().optional(),
      }),
    },
    handlers.flowx_report_progress,
  );
  server.registerTool(
    'flowx_report_evidence',
    {
      title: 'Report FlowX Evidence',
      description: 'Register development evidence for an ExecutionSession.',
      inputSchema: z.object({
        executionSessionId: z.string(),
        evidenceType: evidenceTypeSchema,
        summary: z.string().min(1),
        idempotencyKey: z.string().optional(),
      }),
    },
    handlers.flowx_report_evidence,
  );
  server.registerTool(
    'flowx_get_active_design_session',
    {
      title: 'Get Active OpenDesign Session',
      description:
        'Read the active FlowX OpenDesign session written by flowx-local after “打开本地 OpenDesign”.',
      inputSchema: z.object({
        refresh: z
          .boolean()
          .optional()
          .describe('Optional. Ignored; present so clients always send a valid arguments object.'),
      }),
    },
    handlers.flowx_get_active_design_session,
  );
  server.registerTool(
    'flowx_get_design_handoff',
    {
      title: 'Get OpenDesign Handoff',
      description:
        'Fetch the versioned OpenDesign ContextPackage and output contract for a design workflow.',
      inputSchema: z.object({
        workflowRunId: z
          .string()
          .optional()
          .describe('Defaults to the active local design session when omitted.'),
      }),
    },
    handlers.flowx_get_design_handoff,
  );
  server.registerTool(
    'flowx_get_brainstorm_handoff',
    {
      title: 'Get OpenDesign Brainstorm Handoff',
      description:
        'Fetch the OpenDesign brainstorm ContextPackage. Brainstorm first to clarify product requirements, then produce a confirmed prd.md for PM/designer review (not chat notes).',
      inputSchema: z.object({
        workflowRunId: z
          .string()
          .optional()
          .describe('Defaults to the active local OpenDesign session when omitted.'),
      }),
    },
    handlers.flowx_get_brainstorm_handoff,
  );
  server.registerTool(
    'flowx_submit_design',
    {
      title: 'Submit OpenDesign Result',
      description:
        'Submit the confirmed design.md body and a DesignCompletionReport with self-contained HTML surfaces back to FlowX.',
      inputSchema: z.object({
        executionSessionId: z
          .string()
          .optional()
          .describe('Defaults to the active local design session when omitted.'),
        report: designReportSchema,
      }),
    },
    handlers.flowx_submit_design,
  );
  server.registerTool(
    'flowx_submit_brainstorm',
    {
      title: 'Submit OpenDesign Brainstorm',
      description:
        'Submit confirmed product PRD Markdown (prd.md) after explicit user approval; advances workflow to DESIGN. Legacy spec.md remains compatible. Do not submit drafts or transcripts.',
      inputSchema: z.object({
        executionSessionId: z
          .string()
          .optional()
          .describe('Defaults to the active local OpenDesign session when omitted.'),
        report: brainstormReportSchema,
      }),
    },
    handlers.flowx_submit_brainstorm,
  );
}
