import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LocalSmokeService } from './local-smoke.service';

function createService() {
  const tx = {
    testRun: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    testRunTarget: { create: vi.fn(), update: vi.fn() },
    testRunCase: { create: vi.fn() },
    executionSession: { create: vi.fn(), updateMany: vi.fn() },
    testExecution: { create: vi.fn(), update: vi.fn() },
    testExecutionCaseResult: { create: vi.fn() },
    testRunCaseLease: { create: vi.fn(), deleteMany: vi.fn() },
    evidence: { create: vi.fn() },
    testRequest: { update: vi.fn() },
    testRequestArtifact: { create: vi.fn() },
  };
  const prisma = {
    testRequest: { findUnique: vi.fn(), update: vi.fn() },
    testRun: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    testRunTarget: { findFirst: vi.fn(), update: vi.fn() },
    testRunCase: { findMany: vi.fn() },
    testExecution: { findMany: vi.fn() },
    testExecutionCaseResult: { findMany: vi.fn() },
    testResult: { upsert: vi.fn() },
    evidence: { findMany: vi.fn() },
    executionSession: { findUnique: vi.fn() },
    artifact: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const artifacts = { createServerGeneratedArtifact: vi.fn() };
  return { service: new LocalSmokeService(prisma as never, artifacts as never), prisma, tx, artifacts };
}

describe('LocalSmokeService', () => {
  it('creates a target-by-smoke-case matrix without changing TestRequest status', async () => {
    const { service, prisma, tx } = createService();
    prisma.testRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      status: 'DRAFT',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      scopeRevision: 2,
      workflowLinks: [{ workflowRunId: 'workflow-1' }],
      testPlan: {
        id: 'plan-1',
        snapshots: [
          { id: 'smoke-1', kind: 'SMOKE', metadata: { blocking: false } },
          { id: 'functional-1', kind: 'FUNCTIONAL' },
        ],
      },
    });
    prisma.evidence.findMany.mockResolvedValue([
      {
        metadata: {
          workflowRepositoryId: 'wr-1',
          workingBranch: 'feature/login',
          headSha: 'DEADBEEF',
        },
      },
    ]);
    tx.testRun.create.mockResolvedValue({ id: 'run-1' });
    tx.testRunTarget.create
      .mockResolvedValueOnce({ id: 'target-web' })
      .mockResolvedValueOnce({ id: 'target-api' });
    vi.spyOn(service, 'getTasks').mockResolvedValue({ id: 'run-1' } as never);

    await service.createRun(
      'request-1',
      {
        name: '本地冒烟',
        targets: [
          { key: 'web', name: 'Web', expectedRevisions: [] },
          { key: 'api', name: 'API', expectedRevisions: [] },
        ],
      },
      'user-1',
    );

    expect(tx.testRunCase.create).toHaveBeenCalledTimes(2);
    expect(tx.testRunTarget.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expectedRevisions: [
            { workflowRepositoryId: 'wr-1', branch: 'feature/login', headSha: 'deadbeef' },
          ],
        }),
      }),
    );
    expect(tx.testRunCase.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ blocking: false }) }),
    );
    expect(prisma.testRequest.update).not.toHaveBeenCalled();
  });

  it('persists each claimed case as a database-enforced lease', async () => {
    const { service, prisma, tx } = createService();
    prisma.testRun.findUnique.mockResolvedValue({
      id: 'run-1',
      runType: 'LOCAL_SMOKE',
      status: 'ACTIVE',
      sourceFingerprint: 'fp-1',
      testPlan: {
        testRequest: {
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          workspace: { organizationId: 'org-1' },
        },
      },
    });
    prisma.testRunTarget.findFirst.mockResolvedValue({
      id: 'target-web',
      testRunId: 'run-1',
      cases: [{ id: 'case-1' }],
    });
    prisma.testExecution.findMany.mockResolvedValue([]);

    await service.claim('run-1', { targetId: 'target-web', caseIds: ['case-1'] }, 'user-1');

    expect(tx.testRunCaseLease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ testRunCaseId: 'case-1' }),
    });
  });

  it('rejects a client revision that is not backed by completed development evidence', async () => {
    const { service, prisma } = createService();
    prisma.testRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      status: 'DRAFT',
      scopeRevision: 2,
      workflowLinks: [{ workflowRunId: 'workflow-1' }],
      testPlan: { id: 'plan-1', snapshots: [{ id: 'smoke-1', kind: 'SMOKE' }] },
    });
    prisma.evidence.findMany.mockResolvedValue([
      {
        metadata: {
          workflowRepositoryId: 'wr-1',
          workingBranch: 'feature/login',
          headSha: 'deadbeef',
        },
      },
    ]);

    await expect(
      service.createRun('request-1', {
        name: '本地冒烟',
        targets: [
          {
            key: 'web',
            name: 'Web',
            expectedRevisions: [
              { workflowRepositoryId: 'wr-1', branch: 'feature/login', headSha: 'cafebabe' },
            ],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects claiming case ids that are covered by an active lease', async () => {
    const { service, prisma } = createService();
    prisma.testRun.findUnique.mockResolvedValue({
      id: 'run-1',
      runType: 'LOCAL_SMOKE',
      status: 'ACTIVE',
      sourceFingerprint: 'fp-1',
      testPlan: {
        testRequest: {
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          workspace: { organizationId: 'org-1' },
        },
      },
    });
    prisma.testRunTarget.findFirst.mockResolvedValue({
      id: 'target-web',
      testRunId: 'run-1',
      cases: [{ id: 'case-1' }],
    });
    prisma.testExecution.findMany.mockResolvedValue([
      { claimedCaseIds: ['case-1'], leaseExpiresAt: new Date(Date.now() + 60_000) },
    ]);

    await expect(
      service.claim('run-1', { targetId: 'target-web', caseIds: ['case-1'] }, 'user-2'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('aggregates concurrent results with FAILED taking precedence', async () => {
    const { service, prisma } = createService();
    prisma.testExecutionCaseResult.findMany.mockResolvedValue([
      {
        result: 'PASSED',
        actualResult: null,
        remark: null,
        artifactIds: [],
        createdAt: new Date('2026-09-09T01:00:00Z'),
        testExecution: { claimedByUserId: 'user-1' },
      },
      {
        result: 'FAILED',
        actualResult: '500',
        remark: '接口失败',
        artifactIds: ['log-1'],
        createdAt: new Date('2026-09-09T01:01:00Z'),
        testExecution: { claimedByUserId: 'user-2' },
      },
    ]);
    prisma.testRunCase.findMany.mockResolvedValue([]);

    await service.aggregateCases('run-1', 'fp-1', ['case-1']);

    expect(prisma.testResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ result: 'FAILED', executedByUserId: 'user-2' }),
      }),
    );
  });

  it('stores append-only results, releases leases, and refreshes aggregates on completion', async () => {
    const { service, prisma, tx } = createService();
    prisma.executionSession.findUnique.mockResolvedValue({
      id: 'session-1',
      status: 'RUNNING',
      organizationId: 'org-1',
      sourceTool: 'flowx-local',
      metadata: {},
      testExecution: {
        id: 'execution-1',
        targetId: 'target-web',
        sourceFingerprint: 'fp-1',
        claimedCaseIds: ['case-1'],
        target: {
          id: 'target-web',
          name: 'Web',
          expectedRevisions: [
            { workflowRepositoryId: 'wr-1', branch: 'feature/login', headSha: 'deadbeef' },
          ],
        },
      },
      testRun: {
        id: 'run-1',
        status: 'ACTIVE',
        sourceFingerprint: 'fp-1',
        testPlan: { testRequest: { id: 'request-1' } },
      },
    });
    prisma.artifact.findMany.mockResolvedValue([{ id: 'log-1' }]);
    tx.executionSession.updateMany.mockResolvedValue({ count: 1 });
    vi.spyOn(service, 'aggregateCases').mockResolvedValue();
    vi.spyOn(service as never, 'refreshTargetProgress').mockResolvedValue(undefined as never);
    vi.spyOn(service, 'getTasks').mockResolvedValue({ id: 'run-1' } as never);

    await service.complete(
      'session-1',
      {
        idempotencyKey: 'complete-1',
        sourceFingerprint: 'fp-1',
        testedRevisions: [
          { workflowRepositoryId: 'wr-1', branch: 'feature/login', headSha: 'DEADBEEF' },
        ],
        caseResults: [
          { testRunCaseId: 'case-1', result: 'PASSED', artifactIds: ['log-1'] },
        ],
      },
      { organizationId: 'org-1' },
    );

    expect(tx.testExecutionCaseResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ testRunCaseId: 'case-1', result: 'PASSED' }),
      }),
    );
    expect(tx.testRunCaseLease.deleteMany).toHaveBeenCalledWith({
      where: { testExecutionId: 'execution-1' },
    });
    expect(service.aggregateCases).toHaveBeenCalledWith('run-1', 'fp-1', ['case-1']);
  });

  it('marks a completion stale and releases its leases when tested revisions changed', async () => {
    const { service, prisma, tx } = createService();
    prisma.executionSession.findUnique.mockResolvedValue({
      id: 'session-1',
      status: 'RUNNING',
      organizationId: 'org-1',
      sourceTool: 'flowx-local',
      metadata: {},
      testExecution: {
        id: 'execution-1',
        targetId: 'target-web',
        sourceFingerprint: 'fp-1',
        claimedCaseIds: ['case-1'],
        target: {
          expectedRevisions: [
            { workflowRepositoryId: 'wr-1', branch: 'feature/login', headSha: 'deadbeef' },
          ],
        },
      },
      testRun: {
        id: 'run-1',
        status: 'ACTIVE',
        sourceFingerprint: 'fp-1',
        testPlan: { testRequest: { id: 'request-1' } },
      },
    });

    await expect(
      service.complete(
        'session-1',
        {
          idempotencyKey: 'complete-1',
          sourceFingerprint: 'fp-1',
          testedRevisions: [
            { workflowRepositoryId: 'wr-1', branch: 'feature/login', headSha: 'cafebabe' },
          ],
          caseResults: [{ testRunCaseId: 'case-1', result: 'PASSED' }],
        },
        { organizationId: 'org-1' },
      ),
    ).resolves.toEqual({ status: 'STALE', reason: 'TESTED_REVISIONS_MISMATCH' });
    expect(tx.testRunCaseLease.deleteMany).toHaveBeenCalledWith({
      where: { testExecutionId: 'execution-1' },
    });
  });

  it('blocks finalize when a required blocking case did not pass', async () => {
    const { service, prisma } = createService();
    prisma.testRun.findUnique.mockResolvedValue({
      id: 'run-1',
      runType: 'LOCAL_SMOKE',
      status: 'ACTIVE',
      sourceFingerprint: 'fp-1',
      reportRevision: 0,
      testPlan: {
        testRequest: {
          id: 'request-1',
          status: 'DRAFT',
          scopeGenerationStatus: 'COMPLETED',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
        },
      },
      targets: [{ id: 'target-web', required: true }],
      cases: [
        {
          id: 'case-1',
          required: true,
          blocking: true,
          targetId: 'target-web',
          result: { result: 'FAILED' },
        },
      ],
    });

    await expect(service.finalize('run-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('blocks finalize while another valid execution lease is still running', async () => {
    const { service, prisma } = createService();
    prisma.testRun.findUnique.mockResolvedValue({
      id: 'run-1',
      runType: 'LOCAL_SMOKE',
      status: 'ACTIVE',
      sourceFingerprint: 'fp-1',
      reportRevision: 0,
      testPlan: {
        testRequest: {
          id: 'request-1',
          status: 'DRAFT',
          scopeGenerationStatus: 'COMPLETED',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
        },
      },
      targets: [{ id: 'target-web', required: true }],
      cases: [
        {
          id: 'case-1',
          required: true,
          blocking: true,
          targetId: 'target-web',
          result: { result: 'PASSED' },
        },
      ],
      executions: [
        {
          status: 'RUNNING',
          leaseExpiresAt: new Date(Date.now() + 60_000),
          claimedByUser: { displayName: 'Tester' },
        },
      ],
    });

    await expect(service.finalize('run-1', 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('allows only one concurrent report finalization to claim the active run', async () => {
    const { service, prisma, tx, artifacts } = createService();
    prisma.testRun.findUnique.mockResolvedValue({
      id: 'run-1',
      runType: 'LOCAL_SMOKE',
      status: 'ACTIVE',
      sourceFingerprint: 'fp-1',
      reportRevision: 0,
      testPlan: {
        testRequest: {
          id: 'request-1',
          title: '支付提测',
          status: 'DRAFT',
          scopeGenerationStatus: 'COMPLETED',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          projectVersion: { name: 'v1' },
        },
      },
      targets: [{ id: 'target-web', key: 'web', name: 'Web', required: true, expectedRevisions: [] }],
      cases: [
        {
          id: 'case-1',
          required: true,
          blocking: true,
          targetId: 'target-web',
          snapshot: { title: '登录', priority: 'P0', expected: '成功' },
          result: { result: 'PASSED', actualResult: '成功', remark: null, evidence: null },
        },
      ],
      executions: [],
    });
    artifacts.createServerGeneratedArtifact.mockResolvedValue({ id: 'artifact-1' });
    tx.testRun.updateMany.mockResolvedValue({ count: 0 });
    prisma.artifact.update.mockResolvedValue({ id: 'artifact-1', status: 'DELETED' });

    await expect(service.finalize('run-1', 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.artifact.update).toHaveBeenCalledWith({
      where: { id: 'artifact-1' },
      data: { status: 'DELETED' },
    });
    expect(tx.testRequestArtifact.create).not.toHaveBeenCalled();
  });
});
