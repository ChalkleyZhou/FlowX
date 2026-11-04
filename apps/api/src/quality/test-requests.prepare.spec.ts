import { BadRequestException, ConflictException } from '@nestjs/common';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { TestRequestsService } from './test-requests.service';
import { PrepareTestRequestDto } from './dto/test-request.dto';
import { TestRequestsController } from './test-requests.controller';

function fixture(smoke = false) {
  const request = {
    id: 'request-1', status: 'DRAFT', scopeRevision: 2, scopeGenerationStatus: 'NOT_STARTED',
    workspaceId: 'ws', projectId: 'project', projectVersionId: 'version', testDesignId: 'design',
    testDesign: { id: 'design', status: 'CONFIRMED', workspaceId: 'ws', projectId: 'project', projectVersionId: 'version', coverageChecks: [{ key: 'AC-1', passed: true, detail: '已覆盖' }], uncoveredItems: ['不影响本次范围'], noSmokeReason: null },
    testPlan: { id: 'plan', testDesignId: 'design', status: 'DRAFT', snapshots: [{ id: 'snapshot', kind: smoke ? 'SMOKE' : 'FUNCTIONAL' }], runs: [] as Array<{ id: string; status: string }> },
    workflowLinks: [{ workflowRun: { status: 'DONE' } }],
  };
  const tx = {
    testRequest: {
      findUnique: vi.fn(async () => request),
      updateMany: vi.fn(async (input: { data: Record<string, unknown> }) => {
        const { scopeRevision, ...data } = input.data;
        Object.assign(request, data);
        if (scopeRevision) request.scopeRevision += 1;
        return { count: 1 };
      }),
    },
    testPlan: { update: vi.fn(async () => { request.testPlan.status = 'READY'; return request.testPlan; }) },
  };
  const prisma = { testRequest: { findUnique: vi.fn(async () => request) }, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)) };
  return { request, tx, prisma, service: new TestRequestsService(prisma as never, {} as never) };
}
const complete = { summary: '完成范围', coverageChecks: [{ key: 'AC-1', passed: true }], excludedScopes: [] };
describe('显式准备提测', () => {
  it('冻结范围无冒烟时从确认设计拷贝检查与未覆盖项并转为READY，返回完整提测单', async () => {
    const f = fixture();
    const result = await f.service.prepare('request-1', { scopeRevision: 2 });
    expect(result).toMatchObject({ id: 'request-1', status: 'READY', scopeGenerationStatus: 'COMPLETED', scopeRevision: 3, scopeChecks: f.request.testDesign.coverageChecks, excludedScopes: f.request.testDesign.uncoveredItems });
    expect(f.tx.testRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'request-1', status: 'DRAFT', scopeRevision: 2, scopeGenerationStatus: 'NOT_STARTED' }) }));
    expect(f.request.testPlan.status).toBe('READY');
  });
  it('有SMOKE快照但没有任何冒烟轮次时，只完成范围和计划，不绕过冒烟门禁', async () => {
    const f = fixture(true);
    const result = await f.service.prepare('request-1', { scopeRevision: 2 });
    expect(result).toMatchObject({ status: 'DRAFT', scopeGenerationStatus: 'COMPLETED', scopeRevision: 3 });
    expect(f.request.testPlan.status).toBe('READY');
  });
  it('仅存在失败或未完成冒烟时仍为DRAFT，已通过LOCAL_SMOKE才放行', async () => {
    const f = fixture(true);
    f.request.testPlan.runs = [{ id: 'smoke', status: 'FAILED' }];
    expect(await f.service.prepare('request-1', { scopeRevision: 2 })).toMatchObject({ status: 'DRAFT' });
    const passed = fixture(true);
    passed.request.testPlan.runs = [{ id: 'smoke', status: 'PASSED' }];
    expect(await passed.service.prepare('request-1', { scopeRevision: 2 })).toMatchObject({ status: 'READY' });
  });
  it.each(['design', 'snapshot', 'workflow', 'no-workflow', 'plan-design'] as const)('拒绝缺失前置条件 %s，不写入准备状态', async missing => {
    const f = fixture();
    if (missing === 'design') f.request.testDesign.status = 'WAITING_REVIEW';
    if (missing === 'snapshot') f.request.testPlan.snapshots = [];
    if (missing === 'workflow') f.request.workflowLinks[0].workflowRun.status = 'EXECUTION_RUNNING';
    if (missing === 'no-workflow') f.request.workflowLinks = [];
    if (missing === 'plan-design') f.request.testPlan.testDesignId = 'other-design';
    await expect(f.service.prepare('request-1', { scopeRevision: 2 })).rejects.toBeInstanceOf(BadRequestException);
    expect(f.tx.testRequest.updateMany).not.toHaveBeenCalled();
  });
  it('拒绝过期revision和事务CAS失败，不把计划提前写为READY', async () => {
    const stale = fixture();
    await expect(stale.service.prepare('request-1', { scopeRevision: 1 })).rejects.toBeInstanceOf(ConflictException);
    expect(stale.tx.testPlan.update).not.toHaveBeenCalled();
    const concurrent = fixture();
    concurrent.tx.testRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(concurrent.service.prepare('request-1', { scopeRevision: 2 })).rejects.toBeInstanceOf(ConflictException);
    expect(concurrent.tx.testPlan.update).not.toHaveBeenCalled();
  });
  it.each(['DRAFT', 'READY'])('已完成范围在%s时只接受当前或上一次revision幂等返回，仍复查设计和工作流', async status => {
    const f = fixture();
    f.request.status = status; f.request.scopeGenerationStatus = 'COMPLETED'; f.request.testPlan.status = 'READY';
    expect(await f.service.prepare('request-1', { scopeRevision: 2 })).toMatchObject({ scopeRevision: 2 });
    expect(await f.service.prepare('request-1', { scopeRevision: 1 })).toMatchObject({ scopeRevision: 2 });
    expect(f.tx.testRequest.updateMany).not.toHaveBeenCalled();
    await expect(f.service.prepare('request-1', { scopeRevision: 0 })).rejects.toBeInstanceOf(ConflictException);
    f.request.workflowLinks[0].workflowRun.status = 'REVIEW_RUNNING';
    await expect(f.service.prepare('request-1', { scopeRevision: 2 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('已进入测试不能用prepare重复覆盖状态，确认设计检查失败也不能完成', async () => {
    const f = fixture(); f.request.status = 'IN_TEST'; f.request.scopeGenerationStatus = 'COMPLETED';
    await expect(f.service.prepare('request-1', { scopeRevision: 2 })).rejects.toThrow();
    const checks = fixture(); checks.request.testDesign.coverageChecks[0].passed = false;
    await expect(checks.service.prepare('request-1', { scopeRevision: 2 })).rejects.toThrow();
  });
  it('旧scope/complete无新增必填参数，仍遵守存在SMOKE快照但无已通过轮次的门禁', async () => {
    const f = fixture(true);
    expect(await f.service.completeScope('request-1', complete)).toMatchObject({ status: 'DRAFT', scopeGenerationStatus: 'COMPLETED' });
  });
  it('完成后冻结范围，DRAFT等待冒烟也不能通过补选修改快照', async () => {
    const f = fixture(true); f.request.scopeGenerationStatus = 'COMPLETED'; f.request.testPlan.status = 'READY';
    await expect(f.service.addScopeCases('request-1', { selections: [{ caseId: 'case', reason: '新增', impactLevel: 'HIGH' }] })).rejects.toBeInstanceOf(ConflictException);
  });
  it('Controller透传scopeRevision，DTO只接收非负整数', async () => {
    const f = fixture();
    const controller = new TestRequestsController(f.service);
    expect(await controller.prepare('request-1', { scopeRevision: 2 })).toMatchObject({ status: 'READY' });
    for (const value of [undefined, null, -1, 1.5, '2']) expect(await validate(Object.assign(new PrepareTestRequestDto(), { scopeRevision: value }))).not.toHaveLength(0);
    expect(await validate(Object.assign(new PrepareTestRequestDto(), { scopeRevision: 0 }))).toHaveLength(0);
  });
});
