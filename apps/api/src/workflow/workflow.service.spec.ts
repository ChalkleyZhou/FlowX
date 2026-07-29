import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiInvocationContextService } from '../ai/ai-invocation-context.service';
import type { AiCredentialsService } from '../auth/ai-credentials.service';
import { StageType, WorkflowRunStatus } from '../common/enums';
import type { SpecPlanOutput } from '../common/types';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { WorkflowArtifactService } from './workflow-artifact.service';
import { WorkflowService } from './workflow.service';

const sampleSpecPlan: SpecPlanOutput = {
  spec: {
    goal: '登录后展示欢迎弹框',
    scope: ['欢迎弹框展示'],
    nonGoals: ['改登录鉴权'],
    acceptanceCriteria: ['登录成功后展示一次'],
    constraints: ['复用现有弹框组件'],
  },
  plan: {
    approach: '在 App 挂载欢迎弹框并做频控',
    touchpoints: ['apps/web/src/App.tsx'],
    sequence: ['挂载组件', '加频控', '联调'],
    risks: ['频控状态丢失'],
    verification: ['手动登录验证'],
  },
  notes: {
    checklist: ['确认文案'],
    openQuestions: [],
  },
};

function createService(workflowArtifactService: Partial<WorkflowArtifactService> = {}) {
  const artifactService = {
    writePlanArtifact: vi.fn(),
    confirmPlanArtifact: vi.fn(),
    loadPlanMeta: vi.fn(),
    readPlanHtml: vi.fn(),
    ...workflowArtifactService,
  } as WorkflowArtifactService;

  return {
    service: new WorkflowService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        normalizeAiProvider: (provider?: string | null) => {
          const candidate = provider?.trim().toLowerCase();
          if (candidate === 'cursor') {
            return 'cursor';
          }
          if (candidate === 'codex') {
            return 'codex';
          }
          return 'codex';
        },
        getConfiguredDefaultProvider: () => 'codex' as const,
        resolveInvocationContext: async () => ({}),
      } as never,
      { get: () => ({}) } as never,
      artifactService,
      {} as never,
    ),
    workflowArtifactService: artifactService,
  };
}

describe('WorkflowService resolveConfirmedSpecPlan', () => {
  it('reads SpecPlan from the latest completed SPEC_PLAN stage output', async () => {
    const { service } = createService();

    const resolved = await (
      service as unknown as {
        resolveConfirmedSpecPlan: (workflow: {
          id: string;
          stageExecutions: Array<{
            stage: string;
            status: string;
            attempt: number;
            output: unknown;
          }>;
        }) => Promise<SpecPlanOutput>;
      }
    ).resolveConfirmedSpecPlan({
      id: 'run-spec',
      stageExecutions: [
        {
          stage: 'SPEC_PLAN',
          status: 'COMPLETED',
          attempt: 1,
          output: sampleSpecPlan,
        },
      ],
    });

    expect(resolved).toEqual(sampleSpecPlan);
  });

  it('prefers the highest attempt among completed SPEC_PLAN stages', async () => {
    const { service } = createService();
    const newer: SpecPlanOutput = {
      ...sampleSpecPlan,
      spec: { ...sampleSpecPlan.spec, goal: 'newer goal' },
    };

    const resolved = await (
      service as unknown as {
        resolveConfirmedSpecPlan: (workflow: {
          id: string;
          stageExecutions: Array<{
            stage: string;
            status: string;
            attempt: number;
            output: unknown;
          }>;
        }) => Promise<SpecPlanOutput>;
      }
    ).resolveConfirmedSpecPlan({
      id: 'run-spec',
      stageExecutions: [
        {
          stage: 'SPEC_PLAN',
          status: 'COMPLETED',
          attempt: 1,
          output: sampleSpecPlan,
        },
        {
          stage: 'SPEC_PLAN',
          status: 'COMPLETED',
          attempt: 2,
          output: newer,
        },
      ],
    });

    expect(resolved.spec.goal).toBe('newer goal');
  });

  it('throws NotFoundException when SPEC_PLAN output is missing', async () => {
    const { service } = createService();

    await expect(
      (
        service as unknown as {
          resolveConfirmedSpecPlan: (workflow: {
            id: string;
            stageExecutions: Array<{ stage: string; status: string; attempt: number; output: unknown }>;
          }) => Promise<SpecPlanOutput>;
        }
      ).resolveConfirmedSpecPlan({ id: 'run-missing', stageExecutions: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

function buildWaitingSpecPlanWorkflow(output: unknown = sampleSpecPlan) {
  return {
    id: 'run-sp',
    status: 'SPEC_PLAN_WAITING_CONFIRMATION',
    aiProvider: 'mock',
    requirement: { id: 'req-1', title: 'Test requirement' },
    stageExecutions: [
      {
        id: 'se-1',
        stage: 'SPEC_PLAN',
        status: 'WAITING_CONFIRMATION',
        attempt: 1,
        output,
      },
    ],
  };
}

describe('WorkflowService SpecPlan lifecycle', () => {
  it('runSpecPlan stores normalized output and moves workflow to waiting confirmation', async () => {
    const service = makeServiceWithPrisma({});
    const workflow = {
      id: 'run-sp',
      status: 'SPEC_PLAN_PENDING',
      aiProvider: 'mock',
      requirement: {
        id: 'req-1',
        title: 'Test requirement',
        description: 'desc',
        acceptanceCriteria: 'criteria',
        workspace: { name: 'ws' },
      },
      workflowRepositories: [],
      stageExecutions: [],
    };
    let capturedOutput: unknown;
    let workflowStatus = 'SPEC_PLAN_PENDING';
    const tx = {
      stageExecution: {
        findFirst: vi.fn().mockResolvedValue({ attempt: 0 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'se-run', status: 'RUNNING', attempt: 1 }),
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ id: 'se-run', status: 'RUNNING' })),
        create: vi.fn().mockResolvedValue({ id: 'se-run', attempt: 1, status: 'RUNNING' }),
        update: vi.fn().mockImplementation(async ({ data }: { data: { status?: string; output?: unknown } }) => {
          if (data.output) {
            capturedOutput = data.output;
          }
          return { id: 'se-run', status: data.status ?? 'RUNNING' };
        }),
      },
      workflowRun: {
        update: vi.fn().mockImplementation(async ({ data }: { data: { status: string } }) => {
          workflowStatus = data.status;
          return { id: 'run-sp', status: data.status };
        }),
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({
          ...workflow,
          status: workflowStatus,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (transaction: typeof tx) => unknown) => cb(tx)),
    };
    Object.assign(service, { prisma });

    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow as never);
    vi.spyOn(service as never, 'runInBackground' as never).mockImplementation(
      ((_taskName: string, job: () => Promise<void>) => {
        void job();
      }) as never,
    );
    vi.spyOn(service as never, 'resolveAiExecutor' as never).mockReturnValue({
      generateSpecPlan: vi.fn().mockResolvedValue(sampleSpecPlan),
    } as never);
    vi.spyOn(service as never, 'buildWorkspaceContext' as never).mockReturnValue({} as never);
    vi.spyOn(service as never, 'getWorkflowBriefContext' as never).mockReturnValue(null as never);
    vi.spyOn(service as never, 'getWorkflowDesignContext' as never).mockReturnValue(null as never);
    vi.spyOn(service as never, 'getAiProviderLabel' as never).mockReturnValue('Mock' as never);
    Object.assign(service as object, {
      aiInvocationContextService: {
        resolveInvocationContext: vi.fn().mockResolvedValue({}),
      },
    });

    await service.runSpecPlan('run-sp');

    await vi.waitFor(() => {
      expect(capturedOutput).toEqual(sampleSpecPlan);
      expect(workflowStatus).toBe('SPEC_PLAN_WAITING_CONFIRMATION');
    });
  });

  it('confirmSpecPlan advances to execution pending when output is valid', async () => {
    let finalStatus = 'SPEC_PLAN_WAITING_CONFIRMATION';
    const tx = {
      stageExecution: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'se-1', status: 'WAITING_CONFIRMATION' }),
        update: vi.fn().mockResolvedValue({ id: 'se-1', status: 'COMPLETED' }),
      },
      workflowRun: {
        update: vi.fn().mockImplementation(async ({ data }: { data: { status: string } }) => {
          finalStatus = data.status;
          return { id: 'run-sp', status: data.status };
        }),
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({
          ...buildWaitingSpecPlanWorkflow(),
          status: finalStatus,
          stageExecutions: [],
        })),
      },
    };
    const prisma = {
      workflowRun: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(buildWaitingSpecPlanWorkflow()),
      },
      $transaction: vi.fn().mockImplementation((cb: (transaction: typeof tx) => unknown) => cb(tx)),
    };
    const service = makeServiceWithPrisma(prisma);
    vi.spyOn(service as never, 'notifyStageCompleted' as never).mockImplementation((() => undefined) as never);

    const result = (await service.confirmSpecPlan('run-sp')) as { status: string };

    expect(result.status).toBe('EXECUTION_PENDING');
  });

  it('confirmSpecPlan rejects empty output before advancing', async () => {
    const prisma = {
      workflowRun: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(
          buildWaitingSpecPlanWorkflow({
            spec: { goal: '', scope: [], nonGoals: [], acceptanceCriteria: [], constraints: [] },
            plan: { approach: '', touchpoints: [], sequence: [], risks: [], verification: [] },
          }),
        ),
      },
      $transaction: vi.fn(),
    };
    const service = makeServiceWithPrisma(prisma);

    await expect(service.confirmSpecPlan('run-sp')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejectSpecPlan returns to pending and records feedback on the rejected stage', async () => {
    let rejectedStatusMessage: string | undefined;
    let rejectedOutput: Record<string, unknown> | undefined;
    let finalStatus = 'SPEC_PLAN_WAITING_CONFIRMATION';
    const tx = {
      stageExecution: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'se-1', status: 'WAITING_CONFIRMATION' }),
        findFirst: vi.fn().mockResolvedValue({ attempt: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'se-2', status: 'PENDING', attempt: 2 }),
        update: vi.fn().mockImplementation(async ({ data }: { data: { statusMessage?: string; output?: Record<string, unknown> } }) => {
          rejectedStatusMessage = data.statusMessage;
          rejectedOutput = data.output;
          return { id: 'se-1', status: 'REJECTED' };
        }),
      },
      workflowRun: {
        update: vi.fn().mockImplementation(async ({ data }: { data: { status: string } }) => {
          finalStatus = data.status;
          return { id: 'run-sp', status: data.status };
        }),
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({
          ...buildWaitingSpecPlanWorkflow(),
          status: finalStatus,
          stageExecutions: [],
        })),
      },
    };
    const prisma = {
      workflowRun: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(buildWaitingSpecPlanWorkflow()),
      },
      $transaction: vi.fn().mockImplementation((cb: (transaction: typeof tx) => unknown) => cb(tx)),
    };
    const service = makeServiceWithPrisma(prisma);

    const result = (await service.rejectSpecPlan('run-sp', 'needs more detail')) as { status: string };

    expect(result.status).toBe('SPEC_PLAN_PENDING');
    expect(rejectedStatusMessage).toContain('needs more detail');
    expect(rejectedOutput?.rejectionFeedback).toBe('needs more detail');
    expect(tx.stageExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          statusMessage: expect.stringContaining('needs more detail'),
          input: expect.objectContaining({ humanFeedback: 'needs more detail' }),
        }),
      }),
    );
  });
});

describe('WorkflowService review-finding execution flow', () => {
  it('keeps the workflow in human review pending after fixing a finding', () => {
    const { service } = createService();

    const nextStatus = (service as unknown as {
      getExecutionCompletionTargetStatus: (triggerType?: string) => WorkflowRunStatus;
    }).getExecutionCompletionTargetStatus('review_finding_fix');

    expect(nextStatus).toBe(WorkflowRunStatus.HUMAN_REVIEW_PENDING);
  });

  it('sends regular execution runs back to review pending', () => {
    const { service } = createService();

    const nextStatus = (service as unknown as {
      getExecutionCompletionTargetStatus: (triggerType?: string) => WorkflowRunStatus;
    }).getExecutionCompletionTargetStatus();

    expect(nextStatus).toBe(WorkflowRunStatus.REVIEW_PENDING);
  });

  it('keeps bug_fix execution runs in human review pending', () => {
    const { service } = createService();

    const nextStatus = (service as unknown as {
      getExecutionCompletionTargetStatus: (triggerType?: string) => WorkflowRunStatus;
    }).getExecutionCompletionTargetStatus('bug_fix');

    expect(nextStatus).toBe(WorkflowRunStatus.HUMAN_REVIEW_PENDING);
  });

  it('allows rerunning review from human review pending without extra feedback', () => {
    const { service } = createService();

    const canRunReview = (service as unknown as {
      canRunReviewFromStatus: (status: string) => boolean;
    }).canRunReviewFromStatus('HUMAN_REVIEW_PENDING');

    expect(canRunReview).toBe(true);
  });

  it('marks a review finding as fixed pending review after triggering repair', () => {
    const { service } = createService();

    const nextStatus = (service as unknown as {
      getReviewFindingStatusAfterFix: () => string;
    }).getReviewFindingStatusAfterFix();

    expect(nextStatus).toBe('FIXED_PENDING_REVIEW');
  });
});

describe('WorkflowService optional ideation stages', () => {
  it('builds a standard skipped optional stage output', () => {
    const { service } = createService();

    const output = (service as unknown as {
      buildSkippedStageOutput: (reason: string) => {
        skipped: boolean;
        source: string;
        reason: string;
      };
    }).buildSkippedStageOutput('User chose to skip design.');

    expect(output).toEqual({
      skipped: true,
      source: 'user',
      reason: 'User chose to skip design.',
    });
  });

  it('creates a new pending attempt when rerunning a failed optional stage', async () => {
    const { service } = createService();
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'failed-stage',
        attempt: 1,
        status: 'FAILED',
      })
      .mockResolvedValueOnce({
        attempt: 1,
      });
    const create = vi.fn().mockResolvedValue({
      id: 'new-stage',
      attempt: 2,
      status: 'PENDING',
    });
    const tx = {
      stageExecution: {
        findFirst,
        create,
      },
    } as any;

    const stage = await (service as unknown as {
      getOrCreateRunnableSkippableStageExecution: (
        tx: unknown,
        workflowRunId: string,
        stage: string,
      ) => Promise<{ id: string; attempt: number; status: string }>;
    }).getOrCreateRunnableSkippableStageExecution(tx, 'workflow-1', 'BRAINSTORM');

    expect(stage).toEqual({
      id: 'new-stage',
      attempt: 2,
      status: 'PENDING',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowRunId: 'workflow-1',
          attempt: 2,
          status: 'PENDING',
        }),
      }),
    );
  });

  it('builds workflow repository component context from grounded repositories', async () => {
    const { service } = createService();
    const context = await (service as unknown as {
      buildWorkflowRepositoryComponentContext: (
        executor: unknown,
        workflow: {
          id: string;
          workflowRepositories: Array<{
            id: string;
            repositoryId?: string | null;
            name: string;
            url: string;
            baseBranch: string;
            localPath: string | null;
            status: string;
          }>;
        },
      ) => Promise<{ componentFiles: string[]; propTypes: unknown[]; pageExamples: unknown[] } | null>;
    }).buildWorkflowRepositoryComponentContext(
      {
        buildRepositoryComponentContext: vi.fn().mockResolvedValue({
          componentFiles: ['src/components/NoticeList.tsx'],
          propTypes: [],
          pageExamples: [],
        }),
      },
      {
        id: 'workflow-1',
        workflowRepositories: [
          {
            id: 'wr-1',
            repositoryId: 'repo-1',
            name: 'admin-web',
            url: 'git@example.com:admin-web.git',
            baseBranch: 'main',
            localPath: '/tmp/admin-web',
            status: 'READY',
          },
        ],
      },
    );

    expect(context?.componentFiles).toEqual(['src/components/NoticeList.tsx']);
  });

  it('routes design skip to SPEC_PLAN_PENDING', () => {
    const { service } = createService();

    const target = (
      service as unknown as {
        resolveOptionalStageSkipTarget: (stage: StageType) => {
          to: WorkflowRunStatus;
          pendingStage: StageType | null;
        };
      }
    ).resolveOptionalStageSkipTarget(StageType.DESIGN);

    expect(target.to).toBe(WorkflowRunStatus.SPEC_PLAN_PENDING);
    expect(target.pendingStage).toBe(StageType.SPEC_PLAN);
  });

  it('does not allow skipping SPEC_PLAN', () => {
    const { service } = createService();

    expect(() =>
      (
        service as unknown as {
          resolveOptionalStageSkipTarget: (stage: StageType) => unknown;
        }
      ).resolveOptionalStageSkipTarget(StageType.SPEC_PLAN),
    ).toThrow(/cannot be skipped/i);
  });
});

function makeServiceWithPrisma(prisma: unknown): WorkflowService {
  return new WorkflowService(
    prisma as never,
    new WorkflowStateMachine(),
    {} as never,
    {} as never,
    {} as never,
    { get: () => ({}) } as never,
    { writePlanArtifact: vi.fn() } as never,
    {} as never,
  );
}

const validLocalDesign = {
  design: {
    overview: '高保真设计',
    pages: [{ name: 'P', route: '/p', layout: 'L', keyComponents: [], interactions: [] }],
    demoScenario: 'D',
    designRationale: 'R',
  },
  demo: {
    summary: 'S',
    flows: [{ name: 'n', goal: 'g', entry: 'e', states: [] }],
    scope: { included: [], excluded: [] },
    knownGaps: [],
  },
  designArtifact: { html: '<!doctype html><html><body><h1>X</h1></body></html>' },
};

describe('WorkflowService submitLocalDesign', () => {
  afterEach(async () => {
    const { rm } = await import('fs/promises');
    const { join } = await import('path');
    await rm(join(process.cwd(), '.flowx-data', 'design-artifacts', 'run-ld'), { recursive: true, force: true });
  });

  it('rejects when the workflow is not in a design stage', async () => {
    const prisma = {
      workflowRun: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'run-ld',
          status: 'SPEC_PLAN_PENDING',
          stageExecutions: [],
        }),
      },
    };
    await expect(makeServiceWithPrisma(prisma).submitLocalDesign('run-ld', validLocalDesign)).rejects.toThrow(
      /pending or waiting/,
    );
  });

  it('rejects invalid design output before mutating state', async () => {
    const prisma = {
      workflowRun: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'run-ld',
          status: 'DESIGN_PENDING',
          stageExecutions: [{ id: 'se-1', stage: 'DESIGN', status: 'PENDING', attempt: 1 }],
        }),
      },
    };
    await expect(
      makeServiceWithPrisma(prisma).submitLocalDesign('run-ld', { design: {}, demo: {}, designArtifact: {} }),
    ).rejects.toThrow(/DESIGN_OUTPUT_INVALID/);
  });

  it('persists the artifact and moves the design stage to WAITING_CONFIRMATION', async () => {
    let stageStatus = 'PENDING';
    let capturedOutput: Record<string, unknown> | undefined;
    let finalStatus = 'DESIGN_PENDING';

    const tx = {
      stageExecution: {
        findFirst: vi.fn().mockResolvedValue({ id: 'se-1', stage: 'DESIGN', status: stageStatus, attempt: 1 }),
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ id: 'se-1', status: stageStatus })),
        update: vi.fn().mockImplementation(async ({ data }: { data: { status: string; output?: Record<string, unknown> } }) => {
          stageStatus = data.status;
          if (data.output) {
            capturedOutput = data.output;
          }
          return { id: 'se-1', status: data.status };
        }),
      },
      workflowRun: {
        update: vi.fn().mockImplementation(async ({ data }: { data: { status: string } }) => {
          finalStatus = data.status;
          return { id: 'run-ld', status: data.status };
        }),
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({
          id: 'run-ld',
          status: finalStatus,
          stageExecutions: [{ id: 'se-1', stage: 'DESIGN', status: stageStatus, attempt: 1 }],
        })),
      },
    };

    const prisma = {
      workflowRun: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'run-ld',
          status: 'DESIGN_PENDING',
          stageExecutions: [{ id: 'se-1', stage: 'DESIGN', status: 'PENDING', attempt: 1 }],
        }),
      },
      $transaction: vi.fn().mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx)),
    };

    const result = (await makeServiceWithPrisma(prisma).submitLocalDesign('run-ld', validLocalDesign)) as {
      status: string;
    };

    expect(result.status).toBe('DESIGN_WAITING_CONFIRMATION');
    expect(capturedOutput?.designArtifact).toMatchObject({ relPath: expect.stringContaining('run-ld/') });
    expect(capturedOutput?.design).toBeDefined();
    expect(stageStatus).toBe('WAITING_CONFIRMATION');
  });
});

describe('WorkflowService design artifact persistence', () => {
  it('persists design HTML to disk and reads it back via the stored ref (rejecting traversal)', async () => {
    const { service } = createService();
    const helpers = service as unknown as {
      persistWorkflowDesignArtifact: (runId: string, html: string) => Promise<{ relPath: string; bytes: number }>;
      readWorkflowDesignArtifactHtml: (relPath: string) => Promise<string | null>;
    };

    const runId = `test-${Date.now()}`;
    const html = '<!doctype html><html><body><h1>FlowX</h1></body></html>';
    const ref = await helpers.persistWorkflowDesignArtifact(runId, html);

    expect(ref.relPath.startsWith(`${runId}/`)).toBe(true);
    expect(ref.bytes).toBe(Buffer.byteLength(html, 'utf8'));
    expect(await helpers.readWorkflowDesignArtifactHtml(ref.relPath)).toBe(html);

    expect(await helpers.readWorkflowDesignArtifactHtml('../../etc/passwd')).toBeNull();
    expect(await helpers.readWorkflowDesignArtifactHtml('/etc/passwd')).toBeNull();

    const { rm } = await import('fs/promises');
    const { join } = await import('path');
    await rm(join(process.cwd(), '.flowx-data', 'design-artifacts', runId), { recursive: true, force: true });
  });
});

function createInvocationContextService(overrides?: {
  getCursorApiKeyForOrganization?: (organizationId: string) => Promise<string | null>;
  getCodexApiKeyForOrganization?: (organizationId: string) => Promise<string | null>;
}) {
  const aiCredentialsService = {
    getCursorApiKeyForOrganization: overrides?.getCursorApiKeyForOrganization ?? (async () => null),
    getCodexApiKeyForOrganization: overrides?.getCodexApiKeyForOrganization ?? (async () => null),
  } as AiCredentialsService;
  return new AiInvocationContextService(aiCredentialsService);
}

describe('WorkflowService cursor credential policy', () => {
  const originalRequireUserCredential = process.env.FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL;
  const originalRequireUserCodexCredential = process.env.FLOWX_CODEX_REQUIRE_USER_CREDENTIAL;
  const originalCursorApiKey = process.env.CURSOR_API_KEY;
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalRequireUserCredential === undefined) {
      delete process.env.FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL;
    } else {
      process.env.FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL = originalRequireUserCredential;
    }

    if (originalCursorApiKey === undefined) {
      delete process.env.CURSOR_API_KEY;
    } else {
      process.env.CURSOR_API_KEY = originalCursorApiKey;
    }

    if (originalRequireUserCodexCredential === undefined) {
      delete process.env.FLOWX_CODEX_REQUIRE_USER_CREDENTIAL;
    } else {
      process.env.FLOWX_CODEX_REQUIRE_USER_CREDENTIAL = originalRequireUserCodexCredential;
    }

    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }
  });

  it('blocks cursor execution when user credential is required but missing', async () => {
    process.env.FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL = 'true';
    delete process.env.CURSOR_API_KEY;
    const service = createInvocationContextService({
      getCursorApiKeyForOrganization: async () => null,
    });

    await expect(
      service.resolveInvocationContext('cursor', { flowxUserId: 'user-1', displayName: 'User' }),
    ).rejects.toThrow(/CURSOR_ORGANIZATION_CREDENTIAL_REQUIRED/);
  });

  it('keeps compatibility fallback when strict mode is disabled', async () => {
    process.env.FLOWX_CURSOR_REQUIRE_USER_CREDENTIAL = 'false';
    process.env.CURSOR_API_KEY = 'instance-key';
    const service = createInvocationContextService({
      getCursorApiKeyForOrganization: async () => null,
    });

    await expect(
      service.resolveInvocationContext('cursor', { flowxUserId: 'user-1', displayName: 'User' }),
    ).resolves.toMatchObject({
      cursorCredentialSource: 'instance',
    });
  });

  it('blocks codex execution when user credential is required but missing', async () => {
    process.env.FLOWX_CODEX_REQUIRE_USER_CREDENTIAL = 'true';
    delete process.env.OPENAI_API_KEY;
    const service = createInvocationContextService({
      getCursorApiKeyForOrganization: async () => null,
      getCodexApiKeyForOrganization: async () => null,
    });

    await expect(
      service.resolveInvocationContext('codex', { flowxUserId: 'user-1', displayName: 'User' }),
    ).rejects.toThrow(/CODEX_ORGANIZATION_CREDENTIAL_REQUIRED/);
  });

  it('uses codex organization credential before instance fallback', async () => {
    process.env.FLOWX_CODEX_REQUIRE_USER_CREDENTIAL = 'false';
    process.env.OPENAI_API_KEY = 'instance-openai-key';
    const service = createInvocationContextService({
      getCursorApiKeyForOrganization: async () => null,
      getCodexApiKeyForOrganization: async () => 'org-openai-key',
    });

    await expect(
      service.resolveInvocationContext('codex', {
        flowxUserId: 'user-1',
        flowxOrganizationId: 'org-1',
        displayName: 'User',
      }),
    ).resolves.toMatchObject({
      codexApiKey: 'org-openai-key',
      codexCredentialSource: 'organization',
    });
  });
});

describe('WorkflowService publish retry after partial failure', () => {
  const buildDoneWorkflow = () =>
    ({
      id: 'wf-1',
      status: 'DONE',
      requirement: {
        title: 'Improve publish flow',
      },
      reviewFindings: [],
      reviewReport: { bugs: [] },
      codeExecution: {
        changedFiles: ['apps/api/src/workflow/workflow.service.ts'],
      },
      stageExecutions: [
        {
          stage: 'SPEC_PLAN',
          status: 'COMPLETED',
          attempt: 1,
          output: sampleSpecPlan,
        },
      ],
      workflowRepositories: [
        {
          name: 'flowx',
          workingBranch: 'flowx/workflow-wf-1',
          localPath: '/tmp/flowx-workflow',
          status: 'READY',
          url: 'git@github.com:acme/flowx.git',
        },
      ],
    }) as never;

  it('pushes existing workflow commit when worktree is already clean', async () => {
    const { service } = createService();
    const workflow = buildDoneWorkflow();
    const expectedCommitMessage = (service as unknown as {
      buildWorkflowCommitMessage: (input: unknown) => string;
    }).buildWorkflowCommitMessage(workflow);
    const runGit = vi
      .spyOn(service as never, 'runGit' as never)
      .mockImplementation(async (args: string[]) => {
        if (args[0] === 'log') {
          return { stdout: expectedCommitMessage, stderr: '' };
        }
        if (args[0] === 'rev-parse') {
          return { stdout: 'abc123', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow);
    vi.spyOn(service as never, 'hasGitChanges' as never).mockResolvedValue(false);
    vi.spyOn(service as never, 'resolvePublishRemoteUrl' as never).mockResolvedValue(
      'git@github.com:acme/flowx.git',
    );
    vi.spyOn(service as never, 'remoteBranchExists' as never).mockResolvedValue(true);

    const result = await (service as unknown as { publishGitChanges: (id: string) => Promise<{
      message: string;
      repositories: Array<{ repository: string; branch: string }>;
    }> }).publishGitChanges('wf-1');

    expect(result.message).toBe(expectedCommitMessage);
    expect(result.repositories).toHaveLength(1);
    expect(runGit).toHaveBeenCalledWith(
      expect.arrayContaining(['push', '--set-upstream']),
      '/tmp/flowx-workflow',
    );
    expect(runGit).not.toHaveBeenCalledWith(
      expect.arrayContaining(['commit', '-m', expectedCommitMessage]),
      '/tmp/flowx-workflow',
    );
  });

  it('still reports no new changes when head commit is unrelated', async () => {
    const { service } = createService();
    const workflow = buildDoneWorkflow();
    vi.spyOn(service as never, 'getWorkflowOrThrow' as never).mockResolvedValue(workflow);
    vi.spyOn(service as never, 'hasGitChanges' as never).mockResolvedValue(false);
    vi.spyOn(service as never, 'runGit' as never).mockImplementation(async (args: string[]) => {
      if (args[0] === 'log') {
        return { stdout: 'chore: unrelated commit', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    await expect(
      (service as unknown as { publishGitChanges: (id: string) => Promise<unknown> }).publishGitChanges(
        'wf-1',
      ),
    ).rejects.toThrow('当前工作流没有新的代码改动可提交。');
  });
});
