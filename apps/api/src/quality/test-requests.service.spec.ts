import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TestRequestsService } from './test-requests.service';

function createService() {
  const transaction = {
    testRequest: { create: vi.fn(), update: vi.fn() },
    testPlan: { upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
    testCaseSnapshot: { upsert: vi.fn() },
  };
  const prisma = {
    project: { findFirst: vi.fn() },
    projectVersion: { findFirst: vi.fn() },
    requirement: { findMany: vi.fn() },
    workflowRun: { findMany: vi.fn() },
    artifact: { findMany: vi.fn() },
    testRequest: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
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

  it('freezes confirmed functional and smoke design cases when creating a request', async () => {
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
        proposedCase: { title: '登录成功', priority: 'P1', steps: ['登录'], expected: '进入首页' },
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
          expect.objectContaining({ title: '登录成功', kind: 'FUNCTIONAL' }),
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

  it('keeps a request in draft when any deterministic coverage check fails', async () => {
    const { service, prisma } = createService();
    prisma.testRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      status: 'DRAFT',
      testPlan: { id: 'plan-1', _count: { snapshots: 2 } },
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
      status: 'DRAFT',
      testPlan: { id: 'plan-1', _count: { snapshots: 2 } },
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
    expect(transaction.testRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'request-1' },
        data: expect.objectContaining({ status: 'READY', scopeGenerationStatus: 'COMPLETED' }),
      }),
    );
  });

  it('keeps the request in draft until an existing local smoke run is finalized', async () => {
    const { service, prisma, transaction } = createService();
    prisma.testRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      status: 'DRAFT',
      testPlan: {
        id: 'plan-1',
        _count: { snapshots: 2 },
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

    expect(transaction.testRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DRAFT', scopeGenerationStatus: 'COMPLETED' }),
      }),
    );
  });
});
