import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TestRequestsService } from './test-requests.service';
import { TestRequestStatus } from './quality-status';

function createService() {
  const transaction = {
    testRequest: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    testPlan: { upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    testCaseSnapshot: { upsert: vi.fn() },
  };
  const prisma = {
    project: { findFirst: vi.fn() },
    projectVersion: { findFirst: vi.fn() },
    requirement: { findMany: vi.fn() },
    workflowRun: { findMany: vi.fn() },
    artifact: { findMany: vi.fn() },
    testRequest: { findUnique: transaction.testRequest.findUnique, update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn() },
    testCaseDefinition: { findMany: vi.fn() },
    testDesign: { findUnique: vi.fn() },
    testPlan: { update: vi.fn() },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  };
  const testDesigns = { assertReadyForRequest: vi.fn() };
  return { service: new TestRequestsService(prisma as never, testDesigns as never), prisma, transaction, testDesigns };
}

const requestInput = {
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  projectVersionId: 'version-1',
  title: '2.5.1 提测',
  requirementIds: ['requirement-1'],
  workflowRunIds: ['workflow-1'],
  artifactIds: [],
};

const scopeRequestBase = {
  workspaceId: 'workspace-1', projectId: 'project-1', projectVersionId: 'version-1',
  testDesignId: 'design-1', scopeRevision: 2, scopeGenerationStatus: 'NOT_STARTED',
  testDesign: { id: 'design-1', status: 'CONFIRMED', workspaceId: 'workspace-1', projectId: 'project-1', projectVersionId: 'version-1' },
};

describe('TestRequestsService', () => {
  it('rejects normalized empty requirement and workflow references', async () => {
    const { service } = createService();

    await expect(
      service.createRequest(
        { ...requestInput, requirementIds: ['  '], workflowRunIds: ['  '] },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires linked development workflows to be completed before creating a request', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.projectVersion.findFirst.mockResolvedValue({ id: 'version-1' });
    prisma.requirement.findMany.mockResolvedValue([{ id: 'requirement-1' }]);
    prisma.workflowRun.findMany.mockResolvedValue([
      { id: 'workflow-1', status: 'human_review_pending', requirementId: 'requirement-1' },
    ]);

    await expect(service.createRequest(requestInput, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('requires a confirmed test design before creating a request', async () => {
    const { service, prisma } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.projectVersion.findFirst.mockResolvedValue({ id: 'version-1' });
    prisma.requirement.findMany.mockResolvedValue([{ id: 'requirement-1' }]);
    prisma.workflowRun.findMany.mockResolvedValue([{ id: 'workflow-1', status: 'DONE', requirementId: 'requirement-1' }]);

    await expect(service.createRequest(requestInput, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('saves an AI generated candidate to a selected project library only after explicit action', async () => {
    const prisma = {
      testRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'request-1', workspaceId: 'workspace-1', projectId: 'project-1', status: 'DRAFT', testDesignId: 'design-1' }) },
      testDesignCandidate: {
        findFirst: vi.fn().mockResolvedValue({ id: 'candidate-1', action: 'CREATE', sourceDefinitionId: null, proposedCase: { title: '新登录流程', priority: 'P1', steps: ['登录'], expected: '进入首页' } }),
        update: vi.fn(),
      },
      testRequestScopeCase: { updateMany: vi.fn() },
      testCaseLibrary: { findFirst: vi.fn().mockResolvedValue({ id: 'library-1' }) },
    };
    const caseLibraries = { createCase: vi.fn().mockResolvedValue({ id: 'case-1', version: 1, title: '新登录流程' }) };
    const service = new TestRequestsService(prisma as never, {} as never, caseLibraries as never);

    const result = await service.saveGeneratedCaseToLibrary('request-1', 'candidate-1', { libraryId: 'library-1', moduleId: 'module-1' }, 'user-1');

    expect(caseLibraries.createCase).toHaveBeenCalledWith('library-1', expect.objectContaining({ moduleId: 'module-1', title: '新登录流程', steps: ['登录'] }), 'user-1');
    expect(prisma.testDesignCandidate.update).toHaveBeenCalledWith({ where: { id: 'candidate-1' }, data: { sourceDefinitionId: 'case-1', sourceVersion: 1 } });
    expect(result).toMatchObject({ candidateId: 'candidate-1', testCase: { id: 'case-1' } });
  });

  it.each([
    { name: '候选元数据优先', proposed: { testData: '新测试账号', targetKeys: ['android'] }, expectedData: '新测试账号', expectedTargets: ['android'] },
    { name: '显式清空保留', proposed: { testData: null, targetKeys: [] }, expectedData: null, expectedTargets: [] },
    { name: '旧候选回退来源', proposed: {}, expectedData: '原测试账号', expectedTargets: ['web'] },
  ])('freezes confirmed functional and smoke design cases when creating a request: $name', async ({ proposed, expectedData, expectedTargets }) => {
    const { service, prisma, transaction, testDesigns } = createService();
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.projectVersion.findFirst.mockResolvedValue({ id: 'version-1' });
    prisma.requirement.findMany.mockResolvedValue([{ id: 'requirement-1' }]);
    prisma.workflowRun.findMany.mockResolvedValue([{ id: 'workflow-1', status: 'DONE', requirementId: 'requirement-1' }]);
    transaction.testRequest.create.mockResolvedValue({ id: 'request-1' });
    prisma.testRequest.findUnique.mockResolvedValue({ id: 'request-1', testPlan: { id: 'plan-1' } });
    testDesigns.assertReadyForRequest.mockResolvedValue({
      id: 'design-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      projectVersionId: 'version-1',
      requirements: [{ requirementId: 'requirement-1' }],
      workflowRuns: [{ workflowRunId: 'workflow-1' }],
      candidates: [{
        action: 'REUSE',
        resolution: 'ACCEPTED',
        sourceDefinitionId: 'case-1',
        sourceVersion: 2,
        matchReason: '覆盖主流程',
        proposedCase: { title: '登录成功', priority: 'P1', steps: ['登录'], expected: '进入首页', ...proposed },
        sourceDefinition: { testData: '原测试账号', targetKeys: ['web'] },
      }],
      smokeCases: [{
        resolution: 'ACCEPTED',
        title: '登录冒烟',
        priority: 'P0',
        precondition: null,
        steps: ['登录'],
        expected: '进入首页',
        coverageKeys: ['smoke'],
        blocking: false,
      }],
    });

    await service.createRequest({ ...requestInput, testDesignId: 'design-1' }, 'user-1');

    expect(transaction.testRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ testDesignId: 'design-1' }),
      select: { id: true },
    }));
    expect(prisma.testRequest.create).not.toHaveBeenCalled();
    expect(transaction.testPlan.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        testDesignId: 'design-1',
        snapshots: { create: expect.arrayContaining([
          expect.objectContaining({ title: '登录成功', kind: 'FUNCTIONAL', testData: expectedData, targetKeys: expectedTargets }),
          expect.objectContaining({
            title: '登录冒烟',
            kind: 'SMOKE',
            metadata: { coverageKeys: ['smoke'], blocking: false },
          }),
        ]) },
      }),
    }));
  });

  it('copies only shared or current-project cases into immutable plan snapshots', async () => {
    const { service, prisma, transaction } = createService();
    prisma.testRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      status: 'DRAFT',
      scopeRevision: 1, scopeGenerationStatus: 'NOT_STARTED',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      testPlan: null,
    });
    prisma.testCaseDefinition.findMany.mockResolvedValue([
      {
        id: 'case-1',
        version: 3,
        title: '登录成功',
        priority: 'P0',
        precondition: null,
        steps: ['输入账号'],
        expected: '进入首页',
        metadata: null,
      },
    ]);
    transaction.testPlan.upsert.mockResolvedValue({ id: 'plan-1' });

    await service.addScopeCases(
      'request-1',
      { selections: [{ caseId: 'case-1', reason: '修改了登录鉴权', impactLevel: 'HIGH' }] },
      'user-1',
    );

    expect(prisma.testCaseDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['case-1'] },
          status: 'ACTIVE',
          library: {
            workspaceId: 'workspace-1',
            OR: [{ projectId: null }, { projectId: 'project-1' }],
          },
        },
      }),
    );
    expect(transaction.testCaseSnapshot.upsert).toHaveBeenCalledWith({
      where: {
        testPlanId_sourceDefinitionId_sourceVersion: {
          testPlanId: 'plan-1',
          sourceDefinitionId: 'case-1',
          sourceVersion: 3,
        },
      },
      update: expect.objectContaining({
        selectionReason: '修改了登录鉴权',
        impactLevel: 'HIGH',
      }),
      create: expect.objectContaining({
          testPlanId: 'plan-1',
          sourceDefinitionId: 'case-1',
          sourceVersion: 3,
          selectionReason: '修改了登录鉴权',
          impactLevel: 'HIGH',
      }),
    });
  });

  it('adds manually selected library cases to the active request scope draft without creating snapshots', async () => {
    const transaction = {
      testRequest: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      testDesignCandidate: { create: vi.fn().mockResolvedValue({ id: 'candidate-manual' }), aggregate: vi.fn().mockResolvedValue({ _max: { sortOrder: 0 } }) },
      testRequestScopeCase: { create: vi.fn() },
    };
    const prisma = {
      testRequest: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            id: 'request-1',
            status: 'DRAFT',
            workspaceId: 'workspace-1',
            projectId: 'project-1',
            testDesignId: 'design-1',
            scopeRevision: 3,
            scopeGenerationStatus: 'COMPLETED',
            testDesign: { id: 'design-1', status: 'WAITING_REVIEW' },
          })
          .mockResolvedValue({ id: 'request-1' }),
      },
      testCaseDefinition: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'case-1', libraryId: 'library-1', moduleId: 'module-1', version: 2,
          title: '人工补充登录用例', priority: 'P1', precondition: null, testData: null,
          targetKeys: [], steps: ['输入账号'], expected: '进入首页', tags: [], metadata: null,
          library: { id: 'library-1', name: '项目库' }, module: { id: 'module-1', name: '账号登录' },
        }]),
      },
      testDesignCandidate: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new TestRequestsService(prisma as never, {} as never);

    await service.addScopeDraftCases('request-1', {
      selections: [{ caseId: 'case-1', reason: '人工补充提测范围', impactLevel: 'MEDIUM' }],
    });

    expect(transaction.testRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'request-1', status: 'DRAFT', scopeRevision: 3 },
      data: { scopeRevision: { increment: 1 } },
    }));
    expect(transaction.testDesignCandidate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        testDesignId: 'design-1', sourceDefinitionId: 'case-1', action: 'REUSE',
        resolution: 'ACCEPTED', matchReason: '人工补充提测范围',
      }),
    }));
    expect(transaction.testRequestScopeCase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceDefinitionId: 'case-1', title: '人工补充登录用例', status: 'INCLUDED' }),
    }));
  });

  it('keeps a request in draft when any deterministic coverage check fails', async () => {
    const { service, prisma } = createService();
    prisma.testRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      ...scopeRequestBase,
      status: 'DRAFT',
      testPlan: { id: 'plan-1', testDesignId: 'design-1', status: 'DRAFT', snapshots: [{ id: 'snapshot-1', kind: 'FUNCTIONAL' }] },
      workflowLinks: [{ workflowRun: { status: 'done' } }],
    });

    await expect(
      service.completeScope('request-1', {
        summary: '登录模块回归',
        coverageChecks: [{ key: 'acceptance-criteria', passed: false, detail: '缺少异常登录用例' }],
        excludedScopes: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.testRequest.update).not.toHaveBeenCalled();
  });

  it('marks the plan and request ready in one transaction', async () => {
    const { service, prisma, transaction } = createService();
    prisma.testRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      ...scopeRequestBase,
      status: 'DRAFT',
      testPlan: { id: 'plan-1', testDesignId: 'design-1', status: 'DRAFT', snapshots: [{ id: 'snapshot-1', kind: 'FUNCTIONAL' }] },
      workflowLinks: [{ workflowRun: { status: 'DONE' } }],
    });
    transaction.testRequest.update.mockResolvedValue({ id: 'request-1', status: 'READY' });

    await service.completeScope('request-1', {
      summary: '登录模块回归',
      coverageChecks: [{ key: 'acceptance-criteria', passed: true }],
      excludedScopes: [],
    });

    expect(transaction.testPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: { status: 'READY' },
    });
    expect(transaction.testRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'request-1', status: 'DRAFT', scopeRevision: 2 }),
        data: expect.objectContaining({ status: 'READY', scopeGenerationStatus: 'COMPLETED' }),
      }),
    );
  });

  it('拒绝在提测开始后完成分派，状态条件与版本一起原子校验', async () => {
    const { service, prisma } = createService();
    vi.spyOn(service, 'listAssignments').mockResolvedValue({
      items: [], total: 1, page: 1, pageSize: 1, totalPages: 1, scopeRevision: 3,
      summary: { total: 1, assigned: 1, unassigned: 0 },
    });
    prisma.testRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.completeAssignments('request-1', 3)).rejects.toMatchObject({ status: 409 });
    expect(prisma.testRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'request-1', scopeRevision: 3, status: { in: [TestRequestStatus.DRAFT, TestRequestStatus.READY] } },
      data: { scopeSummary: '1 条功能用例已完成分派' },
    });
  });

  it('keeps the request in draft until an existing local smoke run is finalized', async () => {
    const { service, prisma, transaction } = createService();
    prisma.testRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      ...scopeRequestBase,
      status: 'DRAFT',
      testPlan: {
        id: 'plan-1', testDesignId: 'design-1', status: 'DRAFT',
        snapshots: [{ id: 'snapshot-1', kind: 'SMOKE' }],
        runs: [{ id: 'smoke-run-1', status: 'ACTIVE' }],
      },
      workflowLinks: [{ workflowRun: { status: 'DONE' } }],
    });
    transaction.testRequest.update.mockResolvedValue({ id: 'request-1', status: 'DRAFT' });

    await service.completeScope('request-1', {
      summary: '登录模块回归',
      coverageChecks: [{ key: 'acceptance-criteria', passed: true }],
      excludedScopes: [],
    });

    expect(transaction.testRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DRAFT', scopeGenerationStatus: 'COMPLETED' }),
      }),
    );
  });
});
it('补选未完成范围先CAS递增scopeRevision，竞争失败不写快照', async () => {
  const { service, prisma, transaction } = createService();
  prisma.testRequest.findUnique.mockResolvedValue({ id: 'request-1', status: 'DRAFT', scopeRevision: 4, scopeGenerationStatus: 'NOT_STARTED', workspaceId: 'workspace-1', projectId: 'project-1', testPlan: null });
  prisma.testCaseDefinition.findMany.mockResolvedValue([{ id: 'case-1' }]);
  transaction.testRequest.updateMany.mockResolvedValue({ count: 0 });
  await expect(service.addScopeCases('request-1', { selections: [{ caseId: 'case-1', reason: '调整范围', impactLevel: 'HIGH' }] })).rejects.toMatchObject({ status: 409 });
  expect(transaction.testRequest.updateMany).toHaveBeenCalledWith({ where: { id: 'request-1', status: 'DRAFT', scopeRevision: 4, scopeGenerationStatus: { not: 'COMPLETED' } }, data: { scopeRevision: { increment: 1 }, scopeGenerationStatus: 'NOT_STARTED' } });
  expect(transaction.testPlan.upsert).not.toHaveBeenCalled();
  expect(transaction.testCaseSnapshot.upsert).not.toHaveBeenCalled();
});
