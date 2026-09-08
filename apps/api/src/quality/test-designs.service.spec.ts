import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TestDesignsService } from './test-designs.service';

function setup() {
  const transaction = {
    testDesignCandidate: { deleteMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    testDesignSmokeCase: { deleteMany: vi.fn(), createMany: vi.fn() },
    testDesign: { update: vi.fn(), findUnique: vi.fn() },
    testCaseLibrary: { findFirst: vi.fn(), create: vi.fn() },
    testCaseDefinition: { update: vi.fn(), create: vi.fn() },
  };
  const prisma = {
    project: { findFirst: vi.fn() },
    projectVersion: { findFirst: vi.fn() },
    requirement: { findMany: vi.fn() },
    workflowRun: { findMany: vi.fn() },
    testCaseDefinition: { findMany: vi.fn() },
    testDesignCandidate: { findUnique: vi.fn() },
    testDesign: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  };
  const aiExecutor = { generateTestDesign: vi.fn() };
  const service = new TestDesignsService(prisma as never, aiExecutor as never);
  return { service, prisma, transaction, aiExecutor };
}

const design = {
  id: 'design-1',
  revision: 1,
  status: 'NOT_STARTED',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  projectVersionId: 'version-1',
  sourceSummary: { requirementIds: ['req-1'], workflowRunIds: ['workflow-1'], specPlans: [{ spec: { goal: '登录' } }] },
  requirements: [{ requirement: { id: 'req-1', title: '登录', description: '支持登录', acceptanceCriteria: '进入首页' } }],
  workflowRuns: [{ workflowRun: {} }],
  candidates: [],
  smokeCases: [],
};

describe('TestDesignsService', () => {
  it('reuses a design only when requirement and workflow scopes match exactly', async () => {
    const { service, prisma } = setup();
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.projectVersion.findFirst.mockResolvedValue({ id: 'version-1' });
    prisma.requirement.findMany.mockResolvedValue([
      { id: 'req-1', title: '登录', description: '支持登录', acceptanceCriteria: '进入首页' },
      { id: 'req-2', title: '退出', description: '支持退出', acceptanceCriteria: '返回登录页' },
    ]);
    prisma.workflowRun.findMany.mockResolvedValue([
      {
        id: 'workflow-1',
        requirementId: 'req-1',
        codeExecution: null,
        stageExecutions: confirmedSourceStages(),
      },
      {
        id: 'workflow-2',
        requirementId: 'req-2',
        codeExecution: null,
        stageExecutions: confirmedSourceStages(),
      },
    ]);
    prisma.testDesign.findMany.mockResolvedValue([
      {
        ...design,
        requirements: [{ requirementId: 'req-1' }],
        workflowRuns: [{ workflowRunId: 'workflow-1' }],
      },
    ]);
    prisma.testDesign.findFirst.mockResolvedValue({ revision: 4 });
    prisma.testDesign.create.mockResolvedValue({ id: 'design-2', revision: 5 });

    const result = await service.createDesign({
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      projectVersionId: 'version-1',
      requirementIds: ['req-1', 'req-2'],
      workflowRunIds: ['workflow-1', 'workflow-2'],
    });

    expect(prisma.testDesign.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        revision: 5,
        requirements: { create: [{ requirementId: 'req-1' }, { requirementId: 'req-2' }] },
        workflowRuns: { create: [{ workflowRunId: 'workflow-1' }, { workflowRunId: 'workflow-2' }] },
      }),
    }));
    expect(result).toEqual({ id: 'design-2', revision: 5 });
  });

  it('generates comparable functional and smoke candidates', async () => {
    const { service, prisma, transaction, aiExecutor } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue(design as never);
    prisma.testCaseDefinition.findMany.mockResolvedValueOnce([
      {
        id: 'case-1',
        version: 2,
        title: '登录成功',
        priority: 'P1',
        precondition: null,
        steps: ['输入账号'],
        expected: '进入首页',
        tags: [],
        library: { scope: 'PROJECT', projectId: 'project-1', name: '项目用例库' },
      },
    ]).mockResolvedValueOnce([]);
    prisma.requirement.findMany.mockResolvedValue([{ id: 'req-1', title: '登录', description: '支持登录', acceptanceCriteria: '进入首页' }]);
    prisma.workflowRun.findMany.mockResolvedValue([{ id: 'workflow-1', codeExecution: null, stageExecutions: [{ stage: 'SPEC_PLAN', attempt: 1, output: { spec: { goal: '登录' } } }] }]);
    aiExecutor.generateTestDesign.mockResolvedValue({
      sourceSummary: { generatedBy: 'mock' },
      coverageSummary: { mainFlow: 1 },
      candidates: [{ action: 'REUSE', sourceDefinitionId: 'case-1', sourceVersion: 2, coverageKeys: ['main-flow'], proposedCase: { title: '登录成功', priority: 'P1', steps: ['输入账号'], expected: '进入首页' } }],
      smokeCases: [{ title: '登录冒烟', priority: 'P0', steps: ['登录'], expected: '进入首页', blocking: true, coverageKeys: ['smoke'] }],
      uncoveredItems: [],
    });
    transaction.testDesign.update.mockResolvedValue(undefined);
    transaction.testDesign.findUnique.mockResolvedValue({ ...design, revision: 2, status: 'WAITING_REVIEW' });

    const result = await service.generate('design-1');

    expect(aiExecutor.generateTestDesign).toHaveBeenCalledOnce();
    expect(prisma.testCaseDefinition.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { status: 'ACTIVE', library: { workspaceId: 'workspace-1', projectId: 'project-1' } },
    }));
    expect(prisma.testCaseDefinition.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { status: 'ACTIVE', library: { workspaceId: 'workspace-1', projectId: null } },
    }));
    expect(transaction.testDesignCandidate.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ sourceDefinitionId: 'case-1', action: 'REUSE' })] }));
    expect(transaction.testDesignSmokeCase.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ title: '登录冒烟' })] }));
    expect(result).toEqual(expect.objectContaining({ status: 'WAITING_REVIEW' }));
  });

  it('blocks confirmation while any candidate is unresolved', async () => {
    const { service } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue({
      ...design,
      status: 'WAITING_REVIEW',
      candidates: [{ id: 'candidate-1', resolution: 'PENDING', action: 'CREATE', proposedCase: {} }],
      smokeCases: [],
    } as never);

    await expect(service.confirm('design-1', {
      revision: 1,
      coverageChecks: [],
      uncoveredItems: [],
      noSmokeReason: '无适用冒烟场景',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks confirmation before candidates have been generated', async () => {
    const { service } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue(design as never);

    await expect(service.confirm('design-1', {
      revision: 1,
      coverageChecks: [],
      uncoveredItems: [],
      noCaseReason: '本次无需功能用例',
      noSmokeReason: '本次无需冒烟用例',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not regenerate a design already frozen by a test request', async () => {
    const { service, aiExecutor } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue({
      ...design,
      status: 'CONFIRMED',
      testRequest: { id: 'request-1' },
    } as never);

    await expect(service.generate('design-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(aiExecutor.generateTestDesign).not.toHaveBeenCalled();
  });

  it('does not allow the same confirmed design to be used by another test request', async () => {
    const { service } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue({
      ...design,
      status: 'CONFIRMED',
      testRequest: { id: 'request-1' },
    } as never);

    await expect(service.assertReadyForRequest('design-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires changed reused content to be confirmed as an optimization', async () => {
    const { service, prisma } = setup();
    vi.spyOn(service, 'getDesign').mockResolvedValue({
      ...design,
      status: 'WAITING_REVIEW',
      candidates: [{
        id: 'candidate-1',
        action: 'REUSE',
        resolution: 'ACCEPTED',
        sourceDefinitionId: 'case-1',
        sourceVersion: 2,
        proposedCase: {
          title: '登录成功',
          priority: 'P1',
          precondition: null,
          steps: ['输入账号', '校验新提示'],
          expected: '进入首页',
          tags: [],
        },
      }],
      smokeCases: [{ resolution: 'ACCEPTED' }],
    } as never);
    vi.spyOn(service as unknown as { assertSourceFresh: () => Promise<void> }, 'assertSourceFresh')
      .mockResolvedValue();
    prisma.testCaseDefinition.findMany.mockResolvedValue([{
      id: 'case-1',
      version: 2,
      title: '登录成功',
      priority: 'P1',
      precondition: null,
      steps: ['输入账号'],
      expected: '进入首页',
      tags: [],
    }]);

    await expect(service.confirm('design-1', {
      revision: 1,
      coverageChecks: [],
      uncoveredItems: [],
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});

function confirmedSourceStages() {
  return [
    { stage: 'BRAINSTORM', attempt: 1, output: { brief: {} } },
    { stage: 'DESIGN', attempt: 1, output: { design: {} } },
    { stage: 'SPEC_PLAN', attempt: 1, output: { spec: {} } },
  ];
}
