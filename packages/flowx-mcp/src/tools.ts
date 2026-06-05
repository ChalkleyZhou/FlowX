import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FlowXApiClient } from './flowx-api-client.js';
import { collectGitReport as defaultCollectGitReport } from './git-report.js';

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: 'text'; text: string }>;
};

type GitReport = Awaited<ReturnType<typeof defaultCollectGitReport>>;

export interface FlowXToolDependencies {
  apiClient: FlowXApiClient;
  collectGitReport: (cwd: string) => Promise<GitReport>;
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

export function createFlowXToolHandlers(deps: FlowXToolDependencies) {
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
        return textResult('No changed files were found. Confirm the working tree before reporting completion.', true);
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
}
