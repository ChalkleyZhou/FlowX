import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'smol-toml';

const STRIP_ENV_KEYS = new Set(['FLOWX_API_TOKEN', 'FLOWX_API_BASE_URL']);

export type UserMcpTarget = 'cursor' | 'codex' | 'od';

export type UpsertUserMcpInput = {
  homeDir: string;
  targets: UserMcpTarget[];
  flowxBin: string;
  nodeExecPath?: string;
};

export type UpsertUserMcpResult = {
  written: string[];
};

type McpServer = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export function upsertUserMcp(input: UpsertUserMcpInput): UpsertUserMcpResult {
  const written: string[] = [];
  const nodeExecPath = input.nodeExecPath ?? process.execPath;
  for (const target of input.targets) {
    if (target === 'cursor') {
      written.push(upsertCursorMcp(input.homeDir, input.flowxBin, nodeExecPath));
    } else if (target === 'codex') {
      written.push(upsertCodexMcp(input.homeDir, input.flowxBin, nodeExecPath));
    }
  }
  return { written };
}

function isJsCliEntry(flowxBin: string): boolean {
  return /\.(cjs|mjs|js)$/i.test(flowxBin);
}

function upsertCursorMcp(homeDir: string, flowxBin: string, nodeExecPath: string): string {
  const mcpPath = join(homeDir, '.cursor', 'mcp.json');
  const existing = existsSync(mcpPath) ? parseCursorMcp(mcpPath) : {};
  const mcpServers =
    isPlainObject(existing.mcpServers) && existing.mcpServers
      ? { ...existing.mcpServers }
      : {};
  mcpServers.flowx = buildFlowxServer(mcpServers.flowx, flowxBin, nodeExecPath);
  const updated = { ...existing, mcpServers };
  mkdirSync(dirname(mcpPath), { recursive: true });
  writeFileSync(mcpPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return mcpPath;
}

function parseCursorMcp(mcpPath: string): Record<string, unknown> {
  const raw = readFileSync(mcpPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${mcpPath}`);
  }
  if (!isPlainObject(parsed) || parsed === null) {
    throw new Error(`Invalid JSON in ${mcpPath}`);
  }
  return parsed;
}

function buildFlowxServer(existing: unknown, flowxBin: string, nodeExecPath: string): McpServer {
  const server: McpServer = isJsCliEntry(flowxBin)
    ? { command: nodeExecPath, args: [flowxBin, 'mcp'] }
    : { command: flowxBin, args: ['mcp'] };
  const env = retainedEnv(existing);
  if (env) {
    server.env = env;
  }
  return server;
}

function retainedEnv(existing: unknown): Record<string, string> | undefined {
  if (!isPlainObject(existing) || !isPlainObject(existing.env)) {
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(existing.env)) {
    if (STRIP_ENV_KEYS.has(key) || typeof value !== 'string') {
      continue;
    }
    env[key] = value;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

function upsertCodexMcp(homeDir: string, flowxBin: string, nodeExecPath: string): string {
  const tomlPath = join(homeDir, '.codex', 'config.toml');
  const doc = existsSync(tomlPath) ? parseCodexToml(tomlPath) : {};
  const mcpServers = isPlainObject(doc.mcp_servers) ? { ...doc.mcp_servers } : {};
  mcpServers.flowx = buildFlowxServer(mcpServers.flowx, flowxBin, nodeExecPath);
  doc.mcp_servers = mcpServers;
  mkdirSync(dirname(tomlPath), { recursive: true });
  writeFileSync(tomlPath, stringify(doc), 'utf8');
  return tomlPath;
}

function parseCodexToml(tomlPath: string): Record<string, unknown> {
  const raw = readFileSync(tomlPath, 'utf8');
  try {
    return parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to parse ${tomlPath}`, { cause: error });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
