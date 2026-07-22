import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readActiveDesignSession } from './active-design-session.js';
import {
  FlowXApiClient,
  type BrainstormCompletionReportInput,
  type DesignCompletionReportInput,
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

const designReportSchema = z.object({
  idempotencyKey: z.string().min(1),
  summary: z.string().optional(),
  output: z.object({
    design: z.record(z.string(), z.unknown()),
    demo: z.record(z.string(), z.unknown()),
    designArtifact: z
      .object({
        html: z.string().min(1),
      })
      .passthrough(),
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

      const result = await deps.apiClient.completeLocal(input.workflowRunId, {
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
      });
      return textResult(result);
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
                'Write product brainstorm as Markdown in your Open Design project.',
                'Call flowx_submit_brainstorm with { idempotencyKey, markdown }.',
              ]
            : [
                'Call flowx_get_design_handoff (omit workflowRunId to use this active session).',
                'Design in the Open Design project directory you chose.',
                'Call flowx_submit_design with a DesignCompletionReport including designArtifact.html.',
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
      if (!parsed.data.output.designArtifact.html.includes('<')) {
        return textResult('designArtifact.html must be a complete HTML document.', true);
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
    handlers.flowx_report_completion,
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
        'Fetch the OpenDesign brainstorm ContextPackage. Output must be a single Markdown document.',
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
        'Submit a DesignCompletionReport (including self-contained designArtifact.html) back to FlowX.',
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
      description: 'Submit brainstorm Markdown back to FlowX and advance the workflow to DESIGN.',
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
