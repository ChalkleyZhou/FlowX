import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowArtifactService } from './workflow-artifact.service';

describe('WorkflowArtifactService', () => {
  let artifactsRoot: string;
  let originalArtifactsRoot: string | undefined;
  const service = new WorkflowArtifactService();
  const runId = 'run_test_artifact';

  beforeEach(async () => {
    originalArtifactsRoot = process.env.FLOWX_ARTIFACTS_ROOT;
    artifactsRoot = await mkdtemp(join(tmpdir(), 'flowx-artifacts-'));
    process.env.FLOWX_ARTIFACTS_ROOT = artifactsRoot;
  });

  afterEach(async () => {
    if (originalArtifactsRoot === undefined) {
      delete process.env.FLOWX_ARTIFACTS_ROOT;
    } else {
      process.env.FLOWX_ARTIFACTS_ROOT = originalArtifactsRoot;
    }
    await rm(artifactsRoot, { recursive: true, force: true });
  });

  it('writeExecutionArtifact creates execution files and manifest', async () => {
    const completedAt = '2026-07-29T08:00:00.000Z';
    const result = await service.writeExecutionArtifact({
      workflowRunId: runId,
      version: 1,
      executor: 'LOCAL',
      patchSummary: 'Added welcome modal',
      changedFiles: ['src/App.tsx'],
      meta: {
        executor: 'LOCAL',
        status: 'COMPLETED',
        completedAt,
        patchSummary: 'Added welcome modal',
        changedFiles: ['src/App.tsx'],
        pushed: true,
        repositories: [
          {
            workflowRepositoryId: 'wr-1',
            name: 'flowx',
            workingBranch: 'flowx/work/local',
            headSha: 'deadbeef',
            changedFiles: ['src/App.tsx'],
            verified: true,
          },
        ],
      },
      repositoryRows: [
        {
          name: 'flowx',
          workingBranch: 'flowx/work/local',
          headSha: 'deadbeef',
          changedFileCount: 1,
          pushed: true,
          verified: true,
        },
      ],
      pushed: true,
    });

    expect(result.htmlPath).toBe('execution/v1/report.html');
    expect(result.metaPath).toBe('execution/v1/execution.meta.json');

    const root = service.getArtifactsRoot(runId);
    await access(join(root, result.htmlPath));
    await access(join(root, result.metaPath));

    const html = await readFile(join(root, result.htmlPath), 'utf8');
    const expectedSha = createHash('sha256').update(html).digest('hex');
    expect(result.sha256).toBe(expectedSha);
    expect(html).toContain('Added welcome modal');

    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    expect(manifest.execution).toEqual({
      version: 1,
      path: 'execution/v1/report.html',
      metaPath: 'execution/v1/execution.meta.json',
      sha256: expectedSha,
      executor: 'LOCAL',
      completedAt,
    });
  });

  it('readExecutionHtml returns html after write', async () => {
    await service.writeExecutionArtifact({
      workflowRunId: runId,
      version: 1,
      executor: 'LOCAL',
      patchSummary: 'Added welcome modal',
      changedFiles: ['src/App.tsx'],
      meta: {
        executor: 'LOCAL',
        status: 'COMPLETED',
        completedAt: '2026-07-29T08:00:00.000Z',
        patchSummary: 'Added welcome modal',
        changedFiles: ['src/App.tsx'],
        pushed: true,
        repositories: [],
      },
      repositoryRows: [],
      pushed: true,
    });

    const html = await service.readExecutionHtml(runId);
    expect(html).not.toBeNull();
    expect(html).toContain('Added welcome modal');
  });

  it('readExecutionHtml returns null when no artifact', async () => {
    expect(await service.readExecutionHtml('run_missing')).toBeNull();
  });

  it('keeps the written file when metadata registration fails', async () => {
    const registerWorkflowArtifact = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const registeringService = new WorkflowArtifactService({ registerWorkflowArtifact } as never);

    const result = await registeringService.writeExecutionArtifact({
      workflowRunId: runId,
      version: 2,
      executor: 'LOCAL',
      patchSummary: 'Added welcome modal',
      changedFiles: ['src/App.tsx'],
      meta: {
        executor: 'LOCAL',
        status: 'COMPLETED',
        completedAt: '2026-07-29T08:00:00.000Z',
        patchSummary: 'Added welcome modal',
        changedFiles: ['src/App.tsx'],
        pushed: true,
        repositories: [],
      },
      repositoryRows: [],
      pushed: true,
    });

    await access(join(registeringService.getArtifactsRoot(runId), result.htmlPath));
    expect(registerWorkflowArtifact).toHaveBeenCalledOnce();
  });
});
