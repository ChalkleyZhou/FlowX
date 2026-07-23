import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureProject, writePromptFile } from './ensure-project.js';

const directories: string[] = [];

function makeProject(): string {
  const directory = mkdtempSync(join(tmpdir(), 'flowx-local-project-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ensureProject', () => {
  it('writes missing skills and merges the FlowX MCP server', () => {
    const gitRoot = makeProject();
    const cursorDir = join(gitRoot, '.cursor');
    const mcpPath = join(cursorDir, 'mcp.json');
    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: { existing: { command: 'test' } } }));

    ensureProject(gitRoot, {
      apiBaseUrl: 'https://flowx.example',
      mcpToken: 'token-1',
    });

    expect(existsSync(join(cursorDir, 'skills', 'flowx-local-execution', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(gitRoot, '.agents', 'skills', 'flowx-local-execution', 'SKILL.md'))).toBe(true);
    expect(JSON.parse(readFileSync(mcpPath, 'utf8'))).toEqual({
      mcpServers: {
        existing: { command: 'test' },
        flowx: {
          command: 'flowx-local',
          args: ['mcp'],
          env: {
            FLOWX_API_BASE_URL: 'https://flowx.example',
            FLOWX_API_TOKEN: 'token-1',
          },
        },
      },
    });
  });

  it('does not overwrite an existing skill', () => {
    const gitRoot = makeProject();
    const skillPath = join(gitRoot, '.cursor', 'skills', 'flowx-local-execution', 'SKILL.md');
    mkdirSync(join(gitRoot, '.cursor', 'skills', 'flowx-local-execution'), { recursive: true });
    writeFileSync(skillPath, 'custom instructions');

    ensureProject(gitRoot, {
      apiBaseUrl: 'https://flowx.example',
      mcpToken: 'token-1',
    });

    expect(readFileSync(skillPath, 'utf8')).toBe('custom instructions');
  });
});

describe('writePromptFile', () => {
  it('writes the workflow chat prompt beneath .flowx/tasks', () => {
    const gitRoot = makeProject();

    const promptPath = writePromptFile(gitRoot, 'workflow-1', 'Implement the feature.');

    expect(promptPath).toBe(join(gitRoot, '.flowx', 'tasks', 'workflow-1.md'));
    expect(readFileSync(promptPath, 'utf8')).toBe('Implement the feature.\n');
  });
});
