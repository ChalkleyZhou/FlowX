import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TestRunsService } from './test-runs.service';

function createService() {
  const transaction = {
    testRun: { create: vi.fn() },
    testRequest: { update: vi.fn() },
  };
  const prisma = {
    testRequest: { findUnique: vi.fn(), update: vi.fn() },
    testCaseSnapshot: { findMany: vi.fn() },
    userOrganization: { findMany: vi.fn() },
    bug: { findFirst: vi.fn() },
    testRun: { update: vi.fn() },
    testRunCase: { findUnique: vi.fn(), findMany: vi.fn() },
    testResult: { upsert: vi.fn() },
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  };
  return { service: new TestRunsService(prisma as never), prisma, transaction };
}

describe('TestRunsService', () => {
  it('creates a run only from snapshots in the ready request plan', async () => {
    const { service, prisma, transaction } = createService();
    prisma.testRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      status: 'READY',
      projectId: 'project-1',
      workspace: { organizationId: 'org-1' },
      testPlan: { id: 'plan-1', status: 'READY' },
    });
    prisma.testCaseSnapshot.findMany.mockResolvedValue([{ id: 'snapshot-1' }]);
    transaction.testRun.create.mockResolvedValue({ id: 'run-1' });

    await service.createRun(
      'request-1',
      { name: '第1轮', cases: [{ snapshotId: 'snapshot-1' }] },
      'user-1',
    );

    expect(transaction.testRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          testPlanId: 'plan-1',
          cases: { create: [{ snapshotId: 'snapshot-1', assignedToUserId: null, sortOrder: 0 }] },
        }),
      }),
    );
    expect(transaction.testRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { status: 'IN_TEST' },
    });
  });

  it('requires a completed bug-fix workflow before creating a regression run', async () => {
    const { service, prisma } = createService();
    prisma.testRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      status: 'FAILED',
      projectId: 'project-1',
      workspace: { organizationId: 'org-1' },
      testPlan: { id: 'plan-1', status: 'READY' },
    });
    prisma.testCaseSnapshot.findMany.mockResolvedValue([{ id: 'snapshot-1' }]);
    prisma.bug.findFirst.mockResolvedValue(null);

    await expect(
      service.createRun(
        'request-1',
        {
          name: 'Bug 回归',
          runType: 'REGRESSION',
          sourceBugId: 'bug-1',
          cases: [{ snapshotId: 'snapshot-1' }],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not allow an initial run to reference a bug', async () => {
    const { service, prisma } = createService();
    prisma.testRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      status: 'READY',
      projectId: 'project-1',
      workspace: { organizationId: 'org-1' },
      testPlan: { id: 'plan-1', status: 'READY' },
    });
    prisma.testCaseSnapshot.findMany.mockResolvedValue([{ id: 'snapshot-1' }]);

    await expect(
      service.createRun(
        'request-1',
        {
          name: '首轮测试',
          runType: 'INITIAL',
          sourceBugId: 'bug-1',
          cases: [{ snapshotId: 'snapshot-1' }],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.bug.findFirst).not.toHaveBeenCalled();
  });

  it('prevents another tester from reporting an assigned case result', async () => {
    const { service, prisma } = createService();
    prisma.testRunCase.findUnique.mockResolvedValue({
      id: 'run-case-1',
      assignedToUserId: 'tester-1',
      testRun: { status: 'ACTIVE', testPlan: { testRequest: { projectId: 'project-1' } } },
    });

    await expect(
      service.reportResult('run-case-1', { result: 'PASSED' }, 'tester-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not mark a run as passed when a case was skipped', async () => {
    const { service, prisma } = createService();
    prisma.testRunCase.findUnique.mockResolvedValue({
      id: 'run-case-1',
      assignedToUserId: null,
      testRun: {
        id: 'run-1',
        status: 'ACTIVE',
        testPlan: { testRequest: { id: 'request-1', projectId: 'project-1' } },
      },
    });
    prisma.testResult.upsert.mockResolvedValue({ id: 'result-1', result: 'SKIPPED' });
    prisma.testRunCase.findMany.mockResolvedValue([{ result: { result: 'SKIPPED' } }]);

    await expect(service.reportResult('run-case-1', { result: 'SKIPPED' }, 'user-1')).resolves.toEqual(
      expect.objectContaining({ runStatus: 'BLOCKED', testRequestStatus: 'BLOCKED' }),
    );
  });
});
