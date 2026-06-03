import { describe, expect, it, vi } from 'vitest';
import type { GeneratePlanOutput } from '../common/types';
import { WorkflowService } from './workflow.service';

const sampleOutput: GeneratePlanOutput = {
  summary: 'Add welcome modal',
  implementationPlan: ['Wire modal in App'],
  filesToModify: ['src/App.tsx'],
  newFiles: ['src/WelcomeModal.tsx'],
  riskPoints: ['Rate limit TBD'],
};

function createHookTestService() {
  const writePlanArtifact = vi.fn().mockResolvedValue({
    htmlPath: 'plan/v2/plan.html',
    metaPath: 'plan/v2/plan.meta.json',
    sha256: 'abc123',
  });

  const service = new WorkflowService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      normalizeAiProvider: () => 'codex',
      getConfiguredDefaultProvider: () => 'codex' as const,
      resolveInvocationContext: async () => ({}),
    } as never,
    { get: () => ({}) } as never,
    {
      writePlanArtifact,
      confirmPlanArtifact: vi.fn(),
      loadPlanMeta: vi.fn(),
      readPlanHtml: vi.fn(),
    } as never,
  );

  return { service, writePlanArtifact };
}

describe('WorkflowService plan artifact hook', () => {
  it('attachPlanArtifactToOutput calls writePlanArtifact and merges _artifact', async () => {
    const { service, writePlanArtifact } = createHookTestService();

    const result = await (
      service as unknown as {
        attachPlanArtifactToOutput: (
          workflowRunId: string,
          version: number,
          output: GeneratePlanOutput,
        ) => Promise<GeneratePlanOutput & { _artifact?: Record<string, unknown> }>;
      }
    ).attachPlanArtifactToOutput('run_plan_1', 2, sampleOutput);

    expect(writePlanArtifact).toHaveBeenCalledWith({
      workflowRunId: 'run_plan_1',
      version: 2,
      output: sampleOutput,
      status: 'WAITING_HUMAN_CONFIRMATION',
    });
    expect(result).toEqual({
      ...sampleOutput,
      _artifact: {
        kind: 'plan',
        version: 2,
        htmlPath: 'plan/v2/plan.html',
        metaPath: 'plan/v2/plan.meta.json',
        sha256: 'abc123',
      },
    });
  });

  it('attachPlanArtifactToOutput returns output without _artifact when write fails', async () => {
    const writePlanArtifact = vi.fn().mockRejectedValue(new Error('disk full'));
    const service = new WorkflowService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        normalizeAiProvider: () => 'codex',
        getConfiguredDefaultProvider: () => 'codex' as const,
        resolveInvocationContext: async () => ({}),
      } as never,
      { get: () => ({}) } as never,
      {
        writePlanArtifact,
        confirmPlanArtifact: vi.fn(),
        loadPlanMeta: vi.fn(),
        readPlanHtml: vi.fn(),
      } as never,
    );

    const result = await (
      service as unknown as {
        attachPlanArtifactToOutput: (
          workflowRunId: string,
          version: number,
          output: GeneratePlanOutput,
        ) => Promise<GeneratePlanOutput>;
      }
    ).attachPlanArtifactToOutput('run_plan_2', 1, sampleOutput);

    expect(writePlanArtifact).toHaveBeenCalledOnce();
    expect(result).toEqual(sampleOutput);
    expect(result).not.toHaveProperty('_artifact');
  });
});
