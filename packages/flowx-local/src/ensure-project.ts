import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Ide } from './open-ide.js';

export type EnsureProjectOptions = {
  apiBaseUrl: string;
  mcpToken: string;
  ide?: Ide;
  stage?: 'execution' | 'spec-plan';
};

function templatePath(stage: EnsureProjectOptions['stage']): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
    stage === 'spec-plan' ? 'flowx-spec-plan' : 'flowx-local-execution',
    'SKILL.md',
  );
}

function writeIfMissing(path: string, content: string): void {
  if (existsSync(path)) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

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
  const skill = readFileSync(templatePath(options.stage), 'utf8');
  const skillName = options.stage === 'spec-plan' ? 'flowx-spec-plan' : 'flowx-local-execution';
  if (options.ide === 'workbuddy') {
    writeIfMissing(
      join(gitRoot, '.workbuddy', 'skills', skillName, 'SKILL.md'),
      skill,
    );
    mergeFlowxMcp(join(gitRoot, '.workbuddy', 'mcp.json'), options);
    return;
  }

  writeIfMissing(
    join(gitRoot, '.cursor', 'skills', skillName, 'SKILL.md'),
    skill,
  );
  writeIfMissing(
    join(gitRoot, '.agents', 'skills', skillName, 'SKILL.md'),
    skill,
  );
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
