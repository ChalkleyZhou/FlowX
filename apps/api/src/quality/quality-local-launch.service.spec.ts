import { describe, expect, it, vi } from 'vitest';
import { QualityLocalLaunchService } from './quality-local-launch.service';
import { LocalLaunchTicketStore } from '../workflow/local-launch-ticket.store';

const session = { user: { id: 'user-1' }, organization: { id: 'org-1' } };
function fixture() {
  const run = { id: 'run-1', executionMode: 'LOCAL', status: 'ACTIVE', testPlan: { testRequest: { projectId: 'project-1', workspace: { organizationId: 'org-1' }, workflowLinks: [{ workflowRunId: 'workflow-1' }] } }, targets: [{ id: 'target-1', expectedRevisions: [{ workflowRepositoryId: 'wr-1', branch: 'feature', headSha: 'abc' }] }], cases: [{ id: 'case-1', targetId: 'target-1' }] };
  const prisma = { testRun: { findUnique: vi.fn(async () => run) }, userOrganization: { findUnique: vi.fn(async () => ({ userId: 'user-1' })) }, workflowRepository: { findMany: vi.fn(async () => [{ id: 'wr-1', url: 'https://github.com/org/repo.git', name: 'repo', workflowRunId: 'workflow-1' }]) } };
  const runs = { claim: vi.fn(async () => ({ testRunId: 'run-1', executionSessionId: 'session-1', target: run.targets[0], cases: [{ id: 'case-1' }], testRunRevision: 1, sourceFingerprint: 'fingerprint' })), control: vi.fn() };
  const auth = { createShortLivedSession: vi.fn(async () => ({ token: 'short-token', expiresAt: new Date(Date.now() + 60000) })) };
  const service = new QualityLocalLaunchService(prisma as never, runs as never, auth as never, new LocalLaunchTicketStore());
  return { service, prisma, runs, auth, run };
}
describe('质量测试本地启动', () => {
  it('发票时不领取，设备兑换后使用原用户领取并提供基线和提示词，票据仅兑换一次', async () => {
    const f = fixture();
    const ticket = await f.service.issueTicket('run-1', { targetId: 'target-1', caseIds: ['case-1'], preferredIde: 'codex' }, session);
    expect(f.runs.claim).not.toHaveBeenCalled();
    expect(ticket).toMatchObject({ purpose: 'quality-test', loopbackPort: 3920, preferredIde: 'codex' });
    const redeemed = await f.service.redeemTicket(ticket.ticket, 'device-1');
    expect(f.runs.claim).toHaveBeenCalledWith('run-1', { targetId: 'target-1', caseIds: ['case-1'], deviceId: 'device-1' }, 'user-1');
    expect(redeemed).toMatchObject({ testRunId: 'run-1', executionSessionId: 'session-1', mcpToken: 'short-token', repositories: [{ workflowRepositoryId: 'wr-1', branch: 'feature', headSha: 'abc' }] });
    expect(redeemed.chatPrompt).toContain('flowx_report_test_progress');
    expect(redeemed.chatPrompt).toContain('session-1');
    await expect(f.service.redeemTicket(ticket.ticket, 'device-1')).rejects.toThrow();
  });
  it('拒绝跨组织、未知目标端、其他项目仓库和缺失设备，不创建会话', async () => {
    const f = fixture();
    await expect(f.service.issueTicket('run-1', { targetId: 'target-1' }, { ...session, organization: { id: 'other' } })).rejects.toThrow();
    await expect(f.service.issueTicket('run-1', { targetId: 'other' }, session)).rejects.toThrow();
    const ticket = await f.service.issueTicket('run-1', { targetId: 'target-1' }, session);
    await expect(f.service.redeemTicket(ticket.ticket, ' ')).rejects.toThrow();
    expect(f.runs.claim).not.toHaveBeenCalled();
  });
  it('兑换时复查组织与成员身份，不能用旧票据绕过已撤销权限', async () => {
    const f = fixture();
    const ticket = await f.service.issueTicket('run-1', { targetId: 'target-1' }, session);
    f.prisma.userOrganization.findUnique.mockResolvedValue(null as never);
    await expect(f.service.redeemTicket(ticket.ticket, 'device-1')).rejects.toThrow();
    expect(f.runs.claim).not.toHaveBeenCalled();
  });
  it('领取后短期凭据生成失败会释放已领取用例', async () => {
    const f = fixture();
    const ticket = await f.service.issueTicket('run-1', { targetId: 'target-1' }, session);
    f.auth.createShortLivedSession.mockRejectedValue(new Error('auth unavailable'));
    await expect(f.service.redeemTicket(ticket.ticket, 'device-1')).rejects.toThrow('auth unavailable');
    expect(f.runs.control).toHaveBeenCalledWith('session-1', 'release', expect.objectContaining({ reason: expect.any(String) }), { userId: 'user-1', organizationId: 'org-1' });
  });
});
it('回归允许当前项目已完成修复的代码基线，不把修复仓库误判为原提测之外', async () => {
  const f = fixture();
  Object.assign(f.run, { runType: 'REGRESSION', sourceBug: { projectId: 'project-1', fixWorkflowRunId: 'fix-workflow', fixWorkflowRun: { id: 'fix-workflow', status: 'DONE', requirement: { projectId: 'project-1' } } } });
  f.prisma.workflowRepository.findMany.mockResolvedValue([{ id: 'wr-1', url: 'https://github.com/org/repo.git', name: 'repo', workflowRunId: 'fix-workflow' }]);
  const ticket = await f.service.issueTicket('run-1', { targetId: 'target-1' }, session);
  await f.service.redeemTicket(ticket.ticket, 'device-1');
  expect(f.prisma.workflowRepository.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workflowRunId: { in: ['workflow-1', 'fix-workflow'] } }) }));
});
it('回归不能从其他项目的修复工作流启动', async () => {
  const f = fixture();
  Object.assign(f.run, { runType: 'REGRESSION', sourceBug: { projectId: 'other', fixWorkflowRunId: 'fix-workflow', fixWorkflowRun: { id: 'fix-workflow', status: 'DONE', requirement: { projectId: 'other' } } } });
  const ticket = await f.service.issueTicket('run-1', { targetId: 'target-1' }, session);
  await expect(f.service.redeemTicket(ticket.ticket, 'device-1')).rejects.toThrow();
  expect(f.runs.claim).not.toHaveBeenCalled();
});
