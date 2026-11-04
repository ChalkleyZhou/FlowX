import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TestedRepositoryRevision } from '@flowx-ai/protocol';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePublicApiBaseUrl } from '../common/public-api-base-url';
import { LocalLaunchTicketStore } from '../workflow/local-launch-ticket.store';
import type { LocalLaunchAuthSession } from '../workflow/local-launch.service';
import { LocalTestRunsService } from './local-test-runs.service';
import type { QualityLocalLaunchDto } from './quality-local-launch.controller';

type LaunchContext = QualityLocalLaunchDto & { projectId: string };
@Injectable()
export class QualityLocalLaunchService {
  private readonly contexts = new Map<string, LaunchContext>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: LocalTestRunsService,
    private readonly auth: AuthService,
    private readonly tickets: LocalLaunchTicketStore,
  ) {}

  async issueTicket(testRunId: string, dto: QualityLocalLaunchDto, session: LocalLaunchAuthSession) {
    const run = await this.validateRun(testRunId, dto, session.user.id, session.organization?.id);
    // 复用现有一次性短期票据；这里只把 resource id 存入旧 store 的 workflowRunId 槽位，不调用工作流服务。
    const record = this.tickets.create({ workflowRunId: testRunId, userId: session.user.id, organizationId: session.organization!.id!, expiresAt: Date.now() + 5 * 60 * 1000 });
    this.contexts.set(record.ticket, { ...dto, projectId: run.testPlan.testRequest.projectId });
    return { ticket: record.ticket, expiresAt: new Date(record.expiresAt), loopbackPort: 3920, purpose: 'quality-test' as const, ...(dto.preferredIde ? { preferredIde: dto.preferredIde } : {}) };
  }

  async redeemTicket(ticket: string, deviceId: string) {
    if (!deviceId?.trim()) throw new BadRequestException('本地启动必须提供 deviceId。');
    let record: ReturnType<LocalLaunchTicketStore['consume']>;
    try { record = this.tickets.consume(ticket); } catch { throw new BadRequestException('启动票据无效、已使用或已过期，请重新启动。'); }
    const context = this.contexts.get(ticket);
    this.contexts.delete(ticket);
    if (!context) throw new BadRequestException('启动票据不属于质量测试。');
    const run = await this.validateRun(record.workflowRunId, context, record.userId, record.organizationId);
    if (run.testPlan.testRequest.projectId !== context.projectId) throw new ForbiddenException('测试任务项目已变化。');
    const target = run.targets.find(item => item.id === context.targetId)!;
    const revisions = target.expectedRevisions as unknown as TestedRepositoryRevision[];
    if (!Array.isArray(revisions) || !revisions.length || revisions.some(item => !item.workflowRepositoryId || !item.branch || !item.headSha)) throw new BadRequestException('测试任务缺少完整代码基线。');
    const workflowIds = run.testPlan.testRequest.workflowLinks.map(item => item.workflowRunId);
    if (run.runType === 'REGRESSION') {
      const bug = run.sourceBug;
      const fix = bug?.fixWorkflowRun;
      if (!bug || bug.projectId !== context.projectId || !fix || fix.requirement.projectId !== context.projectId || fix.status.toLowerCase() !== 'done') throw new BadRequestException('回归修复工作流不属于当前项目或尚未完成。');
      workflowIds.push(fix.id);
    }
    const repositories = await this.prisma.workflowRepository.findMany({ where: { id: { in: revisions.map(item => item.workflowRepositoryId) }, workflowRunId: { in: workflowIds } }, select: { id: true, name: true, url: true, workflowRunId: true } });
    if (repositories.length !== revisions.length || revisions.some(item => !repositories.some(repo => repo.id === item.workflowRepositoryId && workflowIds.includes(repo.workflowRunId) && repo.url.trim()))) throw new BadRequestException('代码基线仓库不属于当前提测任务。');
    const claim = await this.runs.claim(run.id, { targetId: context.targetId, ...(context.caseIds ? { caseIds: context.caseIds } : {}), deviceId: deviceId.trim() }, record.userId);
    try {
      const shortLived = await this.auth.createShortLivedSession(record.userId, record.organizationId);
      return {
        purpose: 'quality-test' as const, apiBaseUrl: resolvePublicApiBaseUrl(), testRunId: run.id,
        executionSessionId: claim.executionSessionId, handoff: claim,
        repositories: revisions.map(revision => ({ ...revision, url: repositories.find(item => item.id === revision.workflowRepositoryId)!.url, name: repositories.find(item => item.id === revision.workflowRepositoryId)!.name })),
        chatPrompt: buildQualityPrompt(claim), mcpToken: shortLived.token, mcpTokenExpiresAt: shortLived.expiresAt,
      };
    } catch (error) {
      await this.runs.control(claim.executionSessionId, 'release', { reason: '本地启动交接生成失败。' }, { userId: record.userId, organizationId: record.organizationId ?? undefined });
      throw error;
    }
  }

  private async validateRun(id: string, dto: QualityLocalLaunchDto, userId: string, organizationId?: string | null) {
    if (!organizationId) throw new ForbiddenException('请先选择组织。');
    const membership = await this.prisma.userOrganization.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
    if (!membership) throw new ForbiddenException('当前用户不属于此组织。');
    const run = await this.prisma.testRun.findUnique({ where: { id }, include: { testPlan: { include: { testRequest: { include: { workspace: true, workflowLinks: true } } } }, targets: true, cases: true, sourceBug: { include: { fixWorkflowRun: { select: { id: true, status: true, requirement: { select: { projectId: true } } } } } } } });
    if (!run || run.executionMode !== 'LOCAL') throw new NotFoundException('本地测试轮次不存在。');
    if (run.testPlan.testRequest.workspace.organizationId !== organizationId) throw new ForbiddenException('测试任务不属于当前组织。');
    if (run.status !== 'ACTIVE') throw new BadRequestException('测试轮次已结束。');
    if (!run.targets.some(item => item.id === dto.targetId)) throw new BadRequestException('目标端不属于当前测试轮次。');
    if (dto.caseIds && (!dto.caseIds.length || new Set(dto.caseIds).size !== dto.caseIds.length || dto.caseIds.some(id => !run.cases.some(item => item.id === id && item.targetId === dto.targetId)))) throw new BadRequestException('选中用例不属于当前目标端或存在重复。');
    return run;
  }
}

function buildQualityPrompt(claim: Awaited<ReturnType<LocalTestRunsService['claim']>>) {
  return [
    '# FlowX 本地功能测试', '',
    `测试轮次 testRunId: ${claim.testRunId}`, `执行会话 executionSessionId: ${claim.executionSessionId}`,
    `任务版本 testRunRevision: ${claim.testRunRevision}`, `sourceFingerprint: ${claim.sourceFingerprint}`,
    '先使用 flowx_list_test_tasks 读取任务，以本交接领取的用例为唯一执行范围，不要再次领取。',
    '必须校验所有仓库的分支、HEAD 和工作区；只在指定代码基线上真实执行用例。',
    '使用 flowx_upload_artifact 上传证据，flowx_report_test_progress 分批回传，flowx_submit_test_report 完成会话。',
    '使用 flowx_control_test_execution 续租；无法执行时停止本地进程并 release，说明阻塞原因。',
    '打开 IDE、收到提示词或提交执行报告不代表测试通过；按实际结果回传 PASSED / FAILED / BLOCKED / SKIPPED。',
    '不要自动结束轮次或确认测试设计。', '', '## 已领取任务', JSON.stringify(claim, null, 2),
  ].join('\n');
}
