import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowArtifactService } from './workflow-artifact.service';

const sampleOutput = {
  summary: 'Add welcome modal',
  implementationPlan: ['Wire modal in App'],
  filesToModify: ['src/App.tsx'],
  newFiles: ['src/WelcomeModal.tsx'],
  riskPoints: ['Rate limit TBD'],
};

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

  it('writePlanArtifact creates plan files and manifest', async () => {
    const result = await service.writePlanArtifact({
      workflowRunId: runId,
      version: 1,
      output: sampleOutput,
      status: 'WAITING_HUMAN_CONFIRMATION',
    });

    expect(result.htmlPath).toBe('plan/v1/plan.html');
    expect(result.metaPath).toBe('plan/v1/plan.meta.json');

    const root = service.getArtifactsRoot(runId);
    await access(join(root, result.htmlPath));
    await access(join(root, result.metaPath));

    const html = await readFile(join(root, result.htmlPath), 'utf8');
    const expectedSha = createHash('sha256').update(html).digest('hex');
    expect(result.sha256).toBe(expectedSha);

    const meta = JSON.parse(await readFile(join(root, result.metaPath), 'utf8'));
    expect(meta).toMatchObject({
      ...sampleOutput,
      status: 'WAITING_HUMAN_CONFIRMATION',
      confirmedAt: null,
    });

    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    expect(manifest.plan).toEqual({
      version: 1,
      path: 'plan/v1/plan.html',
      metaPath: 'plan/v1/plan.meta.json',
      sha256: expectedSha,
      confirmedAt: null,
    });
  });

  it('confirmPlanArtifact sets CONFIRMED and manifest confirmedAt', async () => {
    await service.writePlanArtifact({
      workflowRunId: runId,
      version: 1,
      output: sampleOutput,
      status: 'WAITING_HUMAN_CONFIRMATION',
    });

    await service.confirmPlanArtifact(runId);

    const meta = await service.loadPlanMeta(runId);
    expect(meta?.status).toBe('CONFIRMED');
    expect(meta?.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const root = service.getArtifactsRoot(runId);
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    expect(manifest.plan.confirmedAt).toBe(meta?.confirmedAt);
  });

  it('loadPlanMeta returns null when no artifact', async () => {
    expect(await service.loadPlanMeta('run_missing')).toBeNull();
  });

  it('readPlanHtml returns html after write', async () => {
    await service.writePlanArtifact({
      workflowRunId: runId,
      version: 1,
      output: sampleOutput,
      status: 'WAITING_HUMAN_CONFIRMATION',
    });

    const html = await service.readPlanHtml(runId);
    expect(html).not.toBeNull();
    expect(html).toContain('Add welcome modal');
    expect(html).toContain('技术方案');
  });

  it('readPlanHtml returns null when no artifact', async () => {
    expect(await service.readPlanHtml('run_missing')).toBeNull();
  });
});
