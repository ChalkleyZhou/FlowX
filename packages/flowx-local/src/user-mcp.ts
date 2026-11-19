import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'smol-toml';

const STRIP_ENV_KEYS = new Set(['FLOWX_API_TOKEN', 'FLOWX_API_BASE_URL']);

export type UserMcpTarget = 'cursor' | 'codex' | 'od' | 'workbuddy';

export type UpsertUserMcpInput = {
  homeDir: string;
  targets: UserMcpTarget[];
  flowxBin: string;
  nodeExecPath?: string;
  skipUnchanged?: boolean;
};

export type UpsertUserMcpResult = {
  written: string[];
};

type McpServer = {
  [key: string]: unknown;
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export function upsertUserMcp(input: UpsertUserMcpInput): UpsertUserMcpResult {
  const written: string[] = [];
  const nodeExecPath = input.nodeExecPath ?? process.execPath;
  for (const target of input.targets) {
    const path = target === 'cursor' || target === 'workbuddy'
      ? upsertJsonMcp(join(input.homeDir, `.${target}`, 'mcp.json'), input.flowxBin, nodeExecPath, input.skipUnchanged)
      : target === 'codex' ? upsertCodexMcp(input.homeDir, input.flowxBin, nodeExecPath, input.skipUnchanged) : undefined;
    if (path) written.push(path);
  }
  return { written };
}

function isJsCliEntry(flowxBin: string): boolean {
  return /\.(cjs|mjs|js)$/i.test(flowxBin);
}

function upsertJsonMcp(mcpPath: string, flowxBin: string, nodeExecPath: string, skipUnchanged = false): string | undefined {
  const existing = existsSync(mcpPath) ? parseJsonMcp(mcpPath) : {};
  const mcpServers =
    isPlainObject(existing.mcpServers) && existing.mcpServers
      ? { ...existing.mcpServers }
      : {};
  const flowx = buildFlowxServer(mcpServers.flowx, flowxBin, nodeExecPath);
  if (skipUnchanged && isDeepStrictEqual(mcpServers.flowx, flowx)) return undefined;
  mcpServers.flowx = flowx;
  const updated = { ...existing, mcpServers };
  mkdirSync(dirname(mcpPath), { recursive: true });
  writeFileSync(mcpPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return mcpPath;
}

function parseJsonMcp(mcpPath: string): Record<string, unknown> {
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
  const retained = isPlainObject(existing) ? { ...existing } : {};
  delete retained.env;
  const server: McpServer = isJsCliEntry(flowxBin)
    ? { ...retained, command: nodeExecPath, args: [flowxBin, 'mcp'] }
    : { ...retained, command: flowxBin, args: ['mcp'] };
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

function upsertCodexMcp(homeDir: string, flowxBin: string, nodeExecPath: string, skipUnchanged = false): string | undefined {
  const tomlPath = join(homeDir, '.codex', 'config.toml');
  const doc = existsSync(tomlPath) ? parseCodexToml(tomlPath) : {};
  const mcpServers = isPlainObject(doc.mcp_servers) ? { ...doc.mcp_servers } : {};
  const flowx = buildFlowxServer(mcpServers.flowx, flowxBin, nodeExecPath);
  if (skipUnchanged && isDeepStrictEqual(mcpServers.flowx, flowx)) return undefined;
  mcpServers.flowx = flowx;
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
