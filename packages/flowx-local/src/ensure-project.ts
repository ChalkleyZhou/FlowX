import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type EnsureProjectOptions = {
  apiBaseUrl: string;
  mcpToken: string;
  mcpEntryPath?: string;
};

function templatePath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'templates',
    'flowx-local-execution',
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

export function resolveMcpEntryPath(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  const configured = environment.FLOWX_MCP_ENTRY;
  if (configured) {
    return resolve(configured);
  }

  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const candidates = [
    join(cwd, 'packages', 'flowx-mcp', 'dist', 'index.js'),
    join(packageRoot, '..', 'flowx-mcp', 'dist', 'index.js'),
  ];
  const entry = candidates.find(existsSync);
  if (!entry) {
    throw new Error(
      'Unable to locate flowx-mcp. Set FLOWX_MCP_ENTRY to its absolute dist/index.js path.',
    );
  }
  return entry;
}

export function ensureProject(gitRoot: string, options: EnsureProjectOptions): void {
  const skill = readFileSync(templatePath(), 'utf8');
  writeIfMissing(
    join(gitRoot, '.cursor', 'skills', 'flowx-local-execution', 'SKILL.md'),
    skill,
  );
  writeIfMissing(
    join(gitRoot, '.agents', 'skills', 'flowx-local-execution', 'SKILL.md'),
    skill,
  );

  const mcpPath = join(gitRoot, '.cursor', 'mcp.json');
  mkdirSync(dirname(mcpPath), { recursive: true });
  let existing: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(mcpPath)) {
    existing = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
  }
  const mcpEntryPath = options.mcpEntryPath ?? resolveMcpEntryPath();
  if (!isAbsolute(mcpEntryPath)) {
    throw new Error('FlowX MCP entry path must be absolute.');
  }
  const updated = {
    ...existing,
    mcpServers: {
      ...existing.mcpServers,
      flowx: {
        command: 'node',
        args: [mcpEntryPath],
        env: {
          FLOWX_API_BASE_URL: options.apiBaseUrl,
          FLOWX_API_TOKEN: options.mcpToken,
        },
      },
    },
  };
  writeFileSync(mcpPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
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
