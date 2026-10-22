import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StageExecutionStatus, WorkflowRunStatus } from '../common/enums';
import { ExecuteTaskOutput } from '../common/types';
import { WorkflowStateMachine } from '../common/workflow-state-machine';
import { ACTIVE_EXECUTION_SESSION_STATUSES } from '../execution-sessions/execution-session-state';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmCodeDeliveryDto, SubmitCodeBranchDto } from './dto/code-delivery.dto';
import { WorkflowCollaborationActor } from './workflow-collaboration.service';
import { WorkflowGitRemoteService } from './workflow-git-remote.service';

const deliveryInclude = {
  requirement: { include: { workspace: true, project: { include: { workspace: true } } } },
  workflowRepositories: { orderBy: { createdAt: 'asc' } },
  stageExecutions: { orderBy: [{ attempt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] },
  executionSessions: { where: { status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] } }, select: { id: true } },
  codeBranchSubmissions: { orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], include: { submittedByUser: { select: { id: true, displayName: true } } } },
} satisfies Prisma.WorkflowRunInclude;
type Workflow = Prisma.WorkflowRunGetPayload<{ include: typeof deliveryInclude }>;
type Stage = Workflow['stageExecutions'][number];
type Scope = { userId: string; organizationId: string };
type Database = Prisma.TransactionClient;
export type ConfirmedCodeDelivery = {
  confirmedByUserId: string;
  confirmedAt: string;
  submissions: Array<{ id: string; workflowRepositoryId: string; repository: string; branch: string; headSha: string; baseSha: string; submittedByUserId: string }>;
};
export type CodeDeliveryView = {
  workflowRunId: string; canSubmit: boolean; reason: string | null; stageExecutionId: string | null;
  repositories: Array<{ id: string; name: string; baseBranch: string }>;
  submissions: Array<{ id: string; workflowRepositoryId: string; branch: string; headSha: string; submittedBy: { id: string; displayName: string } | null; updatedAt: string }>;
  confirmedDelivery: ConfirmedCodeDelivery | null;
  history: Array<{ stageExecutionId: string; attempt: number; status: string; submissions: CodeDeliveryView['submissions'] }>;
};

@Injectable()
export class WorkflowCodeDeliveryService {
  constructor(private readonly prisma: PrismaService, private readonly stateMachine: WorkflowStateMachine, private readonly git: WorkflowGitRemoteService) {}

  async getDelivery(id: string, actor?: WorkflowCollaborationActor): Promise<CodeDeliveryView> {
    return this.view(await this.accessible(this.prisma, id, this.scope(actor)));
  }

  async submitBranch(id: string, input: SubmitCodeBranchDto, actor?: WorkflowCollaborationActor): Promise<CodeDeliveryView> {
    const scope = this.scope(actor);
    const branch = typeof input?.branch === 'string' ? input.branch.trim() : '';
    if (!branch || branch.length > 255 || !input?.workflowRepositoryId?.trim()) throw new BadRequestException('请选择仓库并填写已推送的分支名。');
    const workflow = await this.accessible(this.prisma, id, scope);
    this.assertCanSubmit(workflow);
    const repository = workflow.workflowRepositories.find((row) => row.id === input.workflowRepositoryId);
    if (!repository) throw new BadRequestException('仓库不属于该工作流。');
    // Git 网络 I/O 不占用 SQLite 事务；写入时再次核对流程与尝试版本。
    const headSha = await this.git.resolveBranchHead(repository.url, branch, scope.organizationId);
    this.assertSha(headSha);
    await this.transaction(async (tx) => {
      await this.lock(tx, workflow, scope);
      const current = await this.accessible(tx, id, scope);
      this.assertCanSubmit(current);
      let stage = this.latestExecution(current);
      if (current.status === 'EXECUTION_PENDING') {
        this.stateMachine.assertWorkflowTransition(WorkflowRunStatus.EXECUTION_PENDING, WorkflowRunStatus.EXECUTION_RUNNING);
        stage = await tx.stageExecution.create({ data: { workflowRunId: id, stage: 'EXECUTION', attempt: (stage?.attempt ?? 0) + 1,
          status: 'RUNNING', input: { executor: 'CODE_DELIVERY' }, startedAt: new Date(), statusMessage: '等待成员提交并统一确认分支交付。' } });
        await tx.workflowRun.update({ where: { id }, data: { status: 'EXECUTION_RUNNING', currentStage: 'EXECUTION', updatedAt: this.nextDate(current.updatedAt) } });
      }
      if (!stage) this.conflict();
      await tx.codeBranchSubmission.upsert({
        where: { stageExecutionId_workflowRepositoryId_branch_submittedByUserId: { stageExecutionId: stage.id, workflowRepositoryId: repository.id, branch, submittedByUserId: scope.userId } },
        create: { workflowRunId: id, stageExecutionId: stage.id, workflowRepositoryId: repository.id, branch, headSha, submittedByUserId: scope.userId },
        update: { headSha },
      });
    });
    return this.getDelivery(id, actor);
  }

  async confirmDelivery(id: string, input: ConfirmCodeDeliveryDto, actor?: WorkflowCollaborationActor): Promise<CodeDeliveryView> {
    const scope = this.scope(actor);
    this.validateSelection(input);
    const workflow = await this.accessible(this.prisma, id, scope);
    if (this.isSameConfirmation(workflow, input)) return this.view(workflow);
    this.assertCanSubmit(workflow);
    const stage = this.latestExecution(workflow);
    if (!stage || workflow.status !== 'EXECUTION_RUNNING') this.conflict();
    const rows = input.submissions.map((selected) => {
      const row = workflow.codeBranchSubmissions.find((submission) => submission.id === selected.id && submission.stageExecutionId === stage.id);
      if (!row || row.headSha !== selected.headSha) this.conflict();
      const repository = workflow.workflowRepositories.find((repo) => repo.id === row.workflowRepositoryId);
      if (!repository) this.conflict();
      return { row, repository };
    });
    if (new Set(rows.map(({ repository }) => repository.id)).size !== rows.length) throw new BadRequestException('同一仓库只能选择一个最终交付分支，请先在 Git 中完成集成。');
    const inspections = await Promise.all(rows.map(async ({ row, repository }) => {
      const diff = await this.git.inspectBranch(repository.url, repository.baseBranch, row.branch, row.headSha, scope.organizationId);
      this.assertSha(diff.headSha); this.assertSha(diff.baseSha);
      if (diff.headSha !== row.headSha) this.conflict();
      if (!diff.changedFiles.length || !diff.diffText.trim()) throw new BadRequestException(`仓库 ${repository.name} 的分支没有实际代码差异。`);
      return { row, repository, diff };
    }));
    const delivery: ConfirmedCodeDelivery = {
      confirmedByUserId: scope.userId, confirmedAt: new Date().toISOString(),
      submissions: inspections.map(({ row, repository, diff }) => ({ id: row.id, workflowRepositoryId: repository.id, repository: repository.name,
        branch: row.branch, headSha: row.headSha, baseSha: diff.baseSha, submittedByUserId: row.submittedByUserId })),
    };
    const output: ExecuteTaskOutput = {
      patchSummary: `已确认 ${rows.length} 个仓库的分支交付。`,
      changedFiles: inspections.flatMap(({ repository, diff }) => diff.changedFiles.map((file) => `${repository.name}/${file}`)),
      codeChanges: inspections.flatMap(({ repository, diff }) => diff.changedFiles.map((file) => ({ file: `${repository.name}/${file}`, changeType: 'update' as const, summary: '分支交付的实际 Git 差异' }))),
      diffArtifacts: inspections.map(({ repository, row, diff }) => ({ repository: repository.name, branch: row.branch, localPath: '', diffStat: diff.diffStat, diffText: diff.diffText, untrackedFiles: [] })),
    };
    await this.transaction(async (tx) => {
      await this.lock(tx, workflow, scope);
      const current = await this.accessible(tx, id, scope);
      this.assertCanSubmit(current);
      if (this.latestExecution(current)?.id !== stage.id) this.conflict();
      const lockedStage = await tx.stageExecution.updateMany({ where: { id: stage.id, workflowRunId: id, status: 'RUNNING', updatedAt: stage.updatedAt },
        data: { status: 'COMPLETED', finishedAt: new Date(), statusMessage: null, output: { ...output, executor: 'CODE_DELIVERY', delivery } as unknown as Prisma.InputJsonValue } });
      if (lockedStage.count !== 1) this.conflict();
      this.stateMachine.assertStageTransition(StageExecutionStatus.RUNNING, StageExecutionStatus.COMPLETED);
      this.stateMachine.assertWorkflowTransition(WorkflowRunStatus.EXECUTION_RUNNING, WorkflowRunStatus.REVIEW_PENDING);
      await tx.codeExecution.upsert({ where: { workflowRunId: id }, create: { workflowRunId: id, status: 'WAITING_HUMAN_REVIEW', ...output }, update: { status: 'WAITING_HUMAN_REVIEW', ...output } });
      const workspace = current.requirement.workspace ?? current.requirement.project?.workspace;
      for (const submission of delivery.submissions) {
        await tx.workflowRepository.update({ where: { id: submission.workflowRepositoryId }, data: { workingBranch: submission.branch, localPath: null } });
        if (workspace) await tx.artifact.create({ data: { workspaceId: workspace.id, projectId: current.requirement.projectId,
          workflowRunId: id, artifactType: 'GIT_COMMIT', name: `${submission.repository}@${submission.headSha}`, status: 'AVAILABLE', createdByUserId: scope.userId,
          metadata: { ...submission, workingBranch: submission.branch, stageExecutionId: stage.id, source: 'CODE_DELIVERY' } } });
      }
      await tx.workflowRun.update({ where: { id }, data: { status: 'REVIEW_PENDING', currentStage: 'AI_REVIEW', updatedAt: this.nextDate(current.updatedAt) } });
    });
    return this.getDelivery(id, actor);
  }

  private view(workflow: Workflow): CodeDeliveryView {
    const stage = ['EXECUTION_RUNNING', 'REVIEW_PENDING', 'HUMAN_REVIEW_PENDING', 'DONE'].includes(workflow.status)
      ? this.latestExecution(workflow) : undefined;
    const reason = this.submissionReason(workflow);
    const submissionsFor = (stageExecutionId: string): CodeDeliveryView['submissions'] =>
      workflow.codeBranchSubmissions.filter((row) => row.stageExecutionId === stageExecutionId).map((row) => ({
        id: row.id, workflowRepositoryId: row.workflowRepositoryId, branch: row.branch, headSha: row.headSha,
        submittedBy: row.submittedByUser, updatedAt: row.updatedAt.toISOString(),
      }));
    return { workflowRunId: workflow.id, canSubmit: reason === null, reason, stageExecutionId: stage?.id ?? null,
      repositories: workflow.workflowRepositories.map(({ id, name, baseBranch }) => ({ id, name, baseBranch })),
      submissions: stage ? submissionsFor(stage.id) : [],
      confirmedDelivery: this.delivery(stage),
      history: workflow.stageExecutions.filter((row) => row.stage === 'EXECUTION' && row.id !== stage?.id).flatMap((row) => {
        const submissions = submissionsFor(row.id);
        return submissions.length ? [{ stageExecutionId: row.id, attempt: row.attempt, status: row.status, submissions }] : [];
      }),
    };
  }
  private latestExecution(workflow: Workflow) { return workflow.stageExecutions.find((stage) => stage.stage === 'EXECUTION'); }
  private submissionReason(workflow: Workflow): string | null {
    if (!['EXECUTION_PENDING', 'EXECUTION_RUNNING'].includes(workflow.status) || workflow.currentStage !== 'EXECUTION') return '当前阶段不允许提交分支交付。';
    const spec = workflow.stageExecutions.find((stage) => stage.stage === 'SPEC_PLAN');
    const specOutput = record(spec?.output); const goal = record(specOutput?.spec)?.goal; const approach = record(specOutput?.plan)?.approach;
    if (spec?.status !== 'COMPLETED' || typeof goal !== 'string' || !goal.trim() || typeof approach !== 'string' || !approach.trim()) return '请先确认当前 Spec & Plan。';
    if (workflow.executionSessions.length) return '已有本地或云端开发会话仍在运行，请通过原入口停止或取消。';
    if (workflow.stageExecutions.some((row) => row.stage === 'EXECUTION' && row.status === 'RUNNING' && record(row.input)?.executor !== 'CODE_DELIVERY')) return '已有本地或云端开发正在执行，请通过原入口停止或取消。';
    const stage = this.latestExecution(workflow);
    if (stage?.status === 'RUNNING' && record(stage.input)?.executor !== 'CODE_DELIVERY') return '已有本地或云端开发正在执行，请通过原入口停止或取消。';
    if (workflow.status === 'EXECUTION_RUNNING' && (!stage || stage.status !== 'RUNNING' || record(stage.input)?.executor !== 'CODE_DELIVERY')) return '开发尝试状态已变化，请重新加载。';
    return null;
  }
  private assertCanSubmit(workflow: Workflow) { const reason = this.submissionReason(workflow); if (reason) throw new ConflictException(reason); }
  private delivery(stage: Stage | undefined): ConfirmedCodeDelivery | null {
    const value = record(stage?.output)?.delivery;
    return stage?.status === 'COMPLETED' && record(value) && Array.isArray(record(value)?.submissions) ? value as unknown as ConfirmedCodeDelivery : null;
  }
  private isSameConfirmation(workflow: Workflow, input: ConfirmCodeDeliveryDto) {
    const delivery = this.delivery(this.latestExecution(workflow));
    return ['REVIEW_PENDING', 'HUMAN_REVIEW_PENDING', 'DONE'].includes(workflow.status) && delivery !== null && delivery.submissions.length === input.submissions.length &&
      input.submissions.every((item) => delivery.submissions.some((row) => row.id === item.id && row.headSha === item.headSha));
  }
  private validateSelection(input: ConfirmCodeDeliveryDto) {
    if (input?.confirmed !== true || !Array.isArray(input.submissions) || !input.submissions.length ||
      input.submissions.some((row) => typeof row?.id !== 'string' || !row.id || typeof row.headSha !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(row.headSha)) ||
      new Set(input.submissions.map((row) => row.id)).size !== input.submissions.length) throw new BadRequestException('请明确选择交付分支并确认提交。');
  }
  private scope(actor?: WorkflowCollaborationActor): Scope {
    if (!actor?.user.id?.trim()) throw new UnauthorizedException('请先登录。');
    if (!actor.organization?.id?.trim()) throw new ForbiddenException('需要组织上下文。');
    return { userId: actor.user.id.trim(), organizationId: actor.organization.id.trim() };
  }
  private async accessible(db: Database, id: string, scope: Scope) {
    const workflow = await db.workflowRun.findUnique({ where: { id }, include: deliveryInclude });
    if (!workflow) throw new NotFoundException('工作流不存在。');
    if ((workflow.requirement.workspace ?? workflow.requirement.project?.workspace)?.organizationId !== scope.organizationId) throw new ForbiddenException('该工作流属于其他组织。');
    return workflow;
  }
  private async lock(tx: Database, before: Workflow, scope: Scope) {
    const current = await this.accessible(tx, before.id, scope);
    if (current.updatedAt.getTime() !== before.updatedAt.getTime() || this.latestExecution(current)?.id !== this.latestExecution(before)?.id ||
      this.latestExecution(current)?.updatedAt.getTime() !== this.latestExecution(before)?.updatedAt.getTime()) this.conflict();
    const locked = await tx.workflowRun.updateMany({ where: { id: before.id, updatedAt: before.updatedAt, status: before.status, currentStage: before.currentStage }, data: { updatedAt: this.nextDate(before.updatedAt) } });
    if (locked.count !== 1) this.conflict();
  }
  private nextDate(previous: Date) { return new Date(Math.max(Date.now(), previous.getTime() + 1)); }
  private assertSha(value: string) { if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) throw new BadRequestException('Git 未返回完整 commit SHA。'); }
  private conflict(): never { throw new ConflictException('工作流或交付分支版本已变化，请重新加载并提交当前尝试。'); }
  private async transaction<T>(callback: (tx: Database) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(callback); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2028', 'P2034', 'P1008'].includes(error.code)) this.conflict();
      throw error;
    }
  }
}
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
