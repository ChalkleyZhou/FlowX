import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOCAL_CONFIG } from '../config.js';
import { OpenDesignAdapter } from './open-design-adapter.js';

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('OpenDesignAdapter', () => {
  it('materializes a local design workspace and submits its result', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flowx-opendesign-'));
    homes.push(homeDir);
    const edgeClient = { submitDesign: vi.fn().mockResolvedValue({ queued: false }) };
    const adapter = new OpenDesignAdapter(
      { ...DEFAULT_LOCAL_CONFIG, openDesignCommand: '' },
      edgeClient as never,
      homeDir,
      async () => ({ opened: true, imported: false }),
    );
    const launchInput: Parameters<OpenDesignAdapter['launch']>[0] = {
      kind: 'opendesign',
      apiBaseUrl: 'http://127.0.0.1:3000',
      accessToken: 'token-1',
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      handoff: {
        protocolVersion: '1.0',
        workflowRunId: 'workflow-1',
        executionSessionId: 'session-1',
        traceId: 'trace-1',
        completionEndpoint: '/execution-sessions/session-1/design/complete',
        contextPackage: {
          protocolVersion: '1.0',
          generatedAt: '2026-07-22T00:00:00.000Z',
          sourceTool: 'opendesign',
          workflowRunId: 'workflow-1',
          executionSessionId: 'session-1',
          traceId: 'trace-1',
          requirement: {
            id: 'req-1',
            title: 'Export',
            description: 'Design export',
            acceptanceCriteria: 'Complete states',
          },
          repositories: [],
          outputContract: {
            resultFileName: 'result.json',
            format: 'flowx-design-result-v2',
            requiredFields: ['design', 'demo', 'surfaces'],
          },
        },
      },
    };
    const launched = await adapter.launch(launchInput);

    expect(readFileSync(launched.contextPath, 'utf8')).toContain('Design export');
    expect(readFileSync(join(homeDir, '.flowx', 'active-design.json'), 'utf8')).toContain(
      'workflow-1',
    );
    expect(JSON.parse(readFileSync(join(homeDir, '.flowx', 'current-workflow.json'), 'utf8'))).toMatchObject({
      workflowRunId: 'workflow-1',
      stage: 'design',
      executionSessionId: 'session-1',
      requirementTitle: 'Export',
    });
    expect(launched.imported).toBe(false);
    expect(readFileSync(join(launched.workspacePath, 'design.md'), 'utf8')).toContain('页面与交互');
    expect(readFileSync(join(launched.workspacePath, 'README.md'), 'utf8')).toContain('design.md');
    expect(readFileSync(join(launched.workspacePath, 'README.md'), 'utf8')).toContain('markdown');
    const result = JSON.parse(readFileSync(launched.resultPath, 'utf8'));
    result.output.surfaces = [
      {
        id: 'Web端',
        pages: [{ id: 'index', html: '<!doctype html><html><body>Done</body></html>' }],
      },
    ];
    writeFileSync(launched.resultPath, JSON.stringify(result));
    writeFileSync(join(launched.workspacePath, 'design.md'), '# 确认设计\n\n导出页面设计。');

    await adapter.launch({
      ...launchInput,
      accessToken: 'token-2',
    });
    expect(readFileSync(launched.resultPath, 'utf8')).toContain('<body>Done</body>');
    expect(readFileSync(join(launched.workspacePath, 'session.json'), 'utf8')).toContain('token-2');

    await adapter.submit('session-1');
    expect(edgeClient.submitDesign).toHaveBeenCalledWith(
      expect.objectContaining({
        executionSessionId: 'session-1',
        accessToken: 'token-2',
        report: expect.objectContaining({ markdown: '# 确认设计\n\n导出页面设计。' }),
      }),
    );
  });

  it('prefers prd.md for brainstorm and falls back to legacy spec.md or brainstorm.md', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'flowx-opendesign-brainstorm-'));
    homes.push(homeDir);
    const edgeClient = { submitBrainstorm: vi.fn().mockResolvedValue({ queued: false }) };
    const adapter = new OpenDesignAdapter(
      { ...DEFAULT_LOCAL_CONFIG, openDesignCommand: '' },
      edgeClient as never,
      homeDir,
      async () => ({ opened: true, imported: false }),
    );
    const launched = await adapter.launch({
      kind: 'opendesign-brainstorm',
      stage: 'brainstorm',
      apiBaseUrl: 'http://127.0.0.1:3000',
      accessToken: 'token-1',
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      handoff: {
        protocolVersion: '1.0',
        workflowRunId: 'workflow-1',
        executionSessionId: 'session-b1',
        traceId: 'trace-1',
        completionEndpoint: '/execution-sessions/session-b1/brainstorm/complete',
        contextPackage: {
          protocolVersion: '1.0',
          generatedAt: '2026-07-22T00:00:00.000Z',
          sourceTool: 'opendesign',
          stage: 'BRAINSTORM',
          workflowRunId: 'workflow-1',
          executionSessionId: 'session-b1',
          traceId: 'trace-1',
          requirement: {
            id: 'req-1',
            title: 'Export',
            description: 'Design export',
            acceptanceCriteria: 'Complete states',
          },
          repositories: [],
          outputContract: {
            resultFileName: 'prd.md',
            format: 'flowx-brainstorm-markdown-v1',
          },
        },
      },
    });

    expect(launched.resultPath.endsWith('prd.md')).toBe(true);
    expect(readFileSync(launched.resultPath, 'utf8')).toContain('flowx-product-prd');
    expect(readFileSync(launched.resultPath, 'utf8')).toContain('背景与问题');
    expect(readFileSync(join(launched.workspacePath, 'README.md'), 'utf8')).toContain('prd.md');
    expect(readFileSync(join(launched.workspacePath, 'README.md'), 'utf8')).toContain(
      'flowx-product-prd',
    );
    expect(readFileSync(join(launched.workspacePath, 'README.md'), 'utf8')).toContain(
      '仅在用户确认后',
    );

    writeFileSync(launched.resultPath, '# Confirmed PRD\n\nShip it.\n');
    await adapter.submit('session-b1');
    expect(edgeClient.submitBrainstorm).toHaveBeenCalledWith(
      expect.objectContaining({
        report: expect.objectContaining({ markdown: '# Confirmed PRD\n\nShip it.\n' }),
      }),
    );

    writeFileSync(launched.resultPath, '   \n');
    writeFileSync(join(launched.workspacePath, 'spec.md'), '# Legacy spec\n');
    await adapter.submit('session-b1');
    expect(edgeClient.submitBrainstorm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        report: expect.objectContaining({ markdown: '# Legacy spec\n' }),
      }),
    );

    writeFileSync(join(launched.workspacePath, 'spec.md'), '   \n');
    writeFileSync(join(launched.workspacePath, 'brainstorm.md'), '# Legacy brainstorm\n');
    await adapter.submit('session-b1');
    expect(edgeClient.submitBrainstorm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        report: expect.objectContaining({ markdown: '# Legacy brainstorm\n' }),
      }),
    );
  });
});
