import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Ide } from './open-ide.js';

export type EnsureProjectOptions = {
  apiBaseUrl: string;
  mcpToken: string;
  ide?: Ide;
  stage?: 'execution' | 'spec-plan';
};

function mergeFlowxMcp(mcpPath: string, options: EnsureProjectOptions): void {
  mkdirSync(dirname(mcpPath), { recursive: true });
  let existing: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(mcpPath)) {
    existing = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
  }
  const updated = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      flowx: {
        command: 'flowx-local',
        args: ['mcp'],
        env: {
          FLOWX_API_BASE_URL: options.apiBaseUrl,
          FLOWX_API_TOKEN: options.mcpToken,
        },
      },
    },
  };
  writeFileSync(mcpPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
}

export function ensureProject(gitRoot: string, options: EnsureProjectOptions): void {
  // 生成技能留在用户级目录，由用户在当前阶段选择。项目启动只合并 MCP。
  if (options.ide === 'workbuddy') {
    mergeFlowxMcp(join(gitRoot, '.workbuddy', 'mcp.json'), options);
    return;
  }

  mergeFlowxMcp(join(gitRoot, '.cursor', 'mcp.json'), options);
}

export function writePromptFile(
  gitRoot: string,
  workflowRunId: string,
  chatPrompt: string,
): string {
  const promptPath = join(gitRoot, '.flowx', 'tasks', `${workflowRunId}.md`);
  mkdirSync(dirname(promptPath), { recursive: true });
  writeFileSync(promptPath, `${chatPrompt.trimEnd()}\n`, 'utf8');
  return promptPath;
}
