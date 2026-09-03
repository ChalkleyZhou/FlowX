import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';
import { upsertUserMcp } from './user-mcp.js';

const homes: string[] = [];
afterEach(() => {
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});

describe('upsertUserMcp', () => {
  it('merges Cursor mcp.json without tokens and preserves other servers', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const mcpPath = join(home, '.cursor', 'mcp.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          other: { command: 'other' },
          flowx: {
            command: 'old',
            args: ['mcp'],
            env: { FLOWX_API_TOKEN: 'fxpat_old', FLOWX_API_BASE_URL: 'http://127.0.0.1:3000', KEEP: 'x' },
          },
        },
      }),
    );
    const result = upsertUserMcp({
      homeDir: home,
      targets: ['cursor'],
      flowxBin: '/usr/local/bin/flowx-local',
    });
    const parsed = JSON.parse(readFileSync(mcpPath, 'utf8'));
    expect(parsed.mcpServers.other).toEqual({ command: 'other' });
    expect(parsed.mcpServers.flowx).toEqual({
      command: '/usr/local/bin/flowx-local',
      args: ['mcp'],
      env: { KEEP: 'x' },
    });
    expect(result.written).toContain(mcpPath);
  });

  it('uses node plus a JS entry so Windows MCP can launch without a .cmd shim', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const js = join(home, 'dist', 'index.js');
    mkdirSync(join(home, 'dist'), { recursive: true });
    writeFileSync(js, 'export {};\n');
    upsertUserMcp({
      homeDir: home,
      targets: ['cursor'],
      flowxBin: js,
      nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
    });
    const parsed = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: { flowx: { command: string; args: string[] } };
    };
    expect(parsed.mcpServers.flowx).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [js, 'mcp'],
    });
  });

  it('upserts Codex [mcp_servers.flowx] and leaves other tables', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const tomlPath = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(tomlPath, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n');
    upsertUserMcp({ homeDir: home, targets: ['codex'], flowxBin: '/bin/flowx-local' });
    const doc = parse(readFileSync(tomlPath, 'utf8')) as {
      model: string;
      mcp_servers: Record<string, { command?: string; args?: string[] }>;
    };
    expect(doc.model).toBe('gpt-5');
    expect(doc.mcp_servers.other.command).toBe('x');
    expect(doc.mcp_servers.flowx).toEqual({ command: '/bin/flowx-local', args: ['mcp'] });
  });

  it('throws on invalid Cursor JSON without overwriting', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const mcpPath = join(home, '.cursor', 'mcp.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(mcpPath, '{not json');
    expect(() =>
      upsertUserMcp({ homeDir: home, targets: ['cursor'], flowxBin: '/bin/flowx-local' }),
    ).toThrow(/mcp.json/);
    expect(readFileSync(mcpPath, 'utf8')).toBe('{not json');
  });

  it('does not write MCP for od', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    upsertUserMcp({ homeDir: home, targets: ['od'], flowxBin: '/bin/flowx-local' });
    expect(() => readFileSync(join(home, '.cursor', 'mcp.json'))).toThrow();
  });

  it('throws on invalid Codex TOML without overwriting', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const tomlPath = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(tomlPath, '[[[broken');
    expect(() =>
      upsertUserMcp({ homeDir: home, targets: ['codex'], flowxBin: '/bin/flowx-local' }),
    ).toThrow(/config\.toml/);
    expect(readFileSync(tomlPath, 'utf8')).toBe('[[[broken');
  });

  it('omits Cursor flowx.env when only token keys remain', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const mcpPath = join(home, '.cursor', 'mcp.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          flowx: {
            command: 'old',
            args: ['mcp'],
            env: { FLOWX_API_TOKEN: 'fxpat_old', FLOWX_API_BASE_URL: 'http://127.0.0.1:3000' },
          },
        },
      }),
    );
    upsertUserMcp({ homeDir: home, targets: ['cursor'], flowxBin: '/bin/flowx-local' });
    const parsed = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
      mcpServers: { flowx: { command: string; args: string[]; env?: unknown } };
    };
    expect(parsed.mcpServers.flowx).toEqual({ command: '/bin/flowx-local', args: ['mcp'] });
    expect(parsed.mcpServers.flowx.env).toBeUndefined();
  });

  it('creates Cursor mcp.json when missing', () => {
    const home = mkdtempSync(join(tmpdir(), 'flowx-mcp-'));
    homes.push(home);
    const mcpPath = join(home, '.cursor', 'mcp.json');
    const result = upsertUserMcp({
      homeDir: home,
      targets: ['cursor'],
      flowxBin: '/bin/flowx-local',
    });
    const parsed = JSON.parse(readFileSync(mcpPath, 'utf8')) as {
      mcpServers: { flowx: { command: string; args: string[] } };
    };
    expect(parsed.mcpServers.flowx).toEqual({ command: '/bin/flowx-local', args: ['mcp'] });
    expect(result.written).toContain(mcpPath);
  });
});
