import { describe, expect, it, vi } from 'vitest';
import { WorkflowService } from './workflow.service';
import { LocalSmokeService } from '../quality/local-smoke.service';

const actor = { user: { id: 'user-b', displayName: '乙' }, organization: { id: 'org-1' } };
const workflow = { requirement: { workspace: { organizationId: 'org-1' }, project: {} }, id: 'workflow-1', status: 'DESIGN_PENDING', currentStage: 'DESIGN' };

describe('本地阶段执行归属', () => {
  it.each(['Design', 'Brainstorm', 'SpecPlan'] as const)('其他人不能复用 %s 已领取会话', async (kind) => {
    const service = Object.create(WorkflowService.prototype) as WorkflowService;
    const stage = kind === 'Brainstorm' ? 'BRAINSTORM' : kind === 'SpecPlan' ? 'SPEC_PLAN' : 'DESIGN';
    const existing = { id: 'session-a', stageExecutionId: 'stage-1', claimedByUserId: 'user-a', organizationId: 'org-1', metadata: { stage } };
    Object.assign(service, { prisma: { executionSession: { findMany: vi.fn().mockResolvedValue([existing]) } } });
    vi.spyOn(service as never, 'getWorkflowOrThrow').mockResolvedValue({ ...workflow, stageExecutions: [{ id: 'stage-1', stage, attempt: 1 }], status: `${stage}_PENDING` } as never);
    vi.spyOn(service as never, `build${kind === 'SpecPlan' ? 'LocalSpecPlan' : kind === 'Brainstorm' ? 'OpenDesignBrainstorm' : 'OpenDesign'}Handoff`).mockReturnValue({} as never);
    await expect(service[`claimLocal${kind}`]('workflow-1', actor)).rejects.toThrow(/领取|执行人/);
  });

  it.each(['Design', 'Brainstorm', 'SpecPlan'] as const)('其他人不能回传 %s 阶段', async (kind) => {
    const service = Object.create(WorkflowService.prototype) as WorkflowService;
    const stage = kind === 'Brainstorm' ? 'BRAINSTORM' : kind === 'SpecPlan' ? 'SPEC_PLAN' : 'DESIGN';
    Object.assign(service, { prisma: { executionSession: { findUnique: vi.fn().mockResolvedValue({
      id: 'session-a', workflowRunId: 'workflow-1', stageExecutionId: 'stage-1',
      claimedByUserId: 'user-a', organizationId: 'org-1', status: 'RUNNING',
      sourceTool: kind === 'SpecPlan' ? 'flowx-local' : 'opendesign', metadata: { stage },
    }) } } });
    const readWorkflow = vi.spyOn(service as never, 'getWorkflowOrThrow').mockRejectedValue(new Error('不应开始写入流程'));
    await expect(service[`completeLocal${kind}Session`]('session-a', {} as never, {
      organizationId: 'org-1', userId: 'user-b',
    })).rejects.toThrow(/领取|执行人/);
    expect(readWorkflow).not.toHaveBeenCalled();
  });

  it('冒烟回传不能冒充其他领取人', async () => {
    const service = Object.create(LocalSmokeService.prototype) as LocalSmokeService;
    Object.assign(service, { prisma: { executionSession: { findUnique: vi.fn().mockResolvedValue({
      id: 'session-a', stageExecutionId: 'stage-1', claimedByUserId: 'user-a', organizationId: 'org-1', status: 'RUNNING',
      sourceTool: 'flowx-local', testExecution: {}, testRun: { status: 'ACTIVE' },
    }) } } });
    await expect(service.complete('session-a', {} as never, {
      organizationId: 'org-1', userId: 'user-b',
    })).rejects.toThrow(/领取|执行人/);
  });
});

describe('归属校验边界', () => {
  it('同一执行人可重试，管理员身份不授予冒名回传权', async () => {
    const { assertLocalSessionOwner } = await import('./workflow-local-ownership');
    const session = { id: 's', claimedByUserId: 'a', organizationId: 'o' };
    expect(() => assertLocalSessionOwner(session, { userId: 'a', organizationId: 'o' })).not.toThrow();
    expect(() => assertLocalSessionOwner(session, { userId: 'b', organizationId: 'o' })).toThrow(/原领取/);
    expect(() => assertLocalSessionOwner(session, { userId: 'a', organizationId: 'other' })).toThrow(/其他组织/);
    expect(() => assertLocalSessionOwner({ ...session, claimedByUserId: null }, { userId: 'a', organizationId: 'o' })).toThrow(/未记录/);
  });
});
