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
            format: 'flowx-design-result-v1',
            requiredFields: ['design', 'demo', 'designArtifact'],
          },
        },
      },
    };
    const launched = await adapter.launch(launchInput);

    expect(readFileSync(launched.contextPath, 'utf8')).toContain('Design export');
    const result = JSON.parse(readFileSync(launched.resultPath, 'utf8'));
    result.output.designArtifact.html = '<!doctype html><html><body>Done</body></html>';
    writeFileSync(launched.resultPath, JSON.stringify(result));

    await adapter.launch({
      ...launchInput,
      accessToken: 'token-2',
    });
    expect(readFileSync(launched.resultPath, 'utf8')).toContain('<body>Done</body>');
    expect(readFileSync(join(launched.workspacePath, 'session.json'), 'utf8')).toContain('token-2');

    await adapter.submit('session-1');
    expect(edgeClient.submitDesign).toHaveBeenCalledWith(
      expect.objectContaining({ executionSessionId: 'session-1', accessToken: 'token-2' }),
    );
  });
});
