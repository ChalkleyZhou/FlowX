import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type RequirementChange } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import { CreateRequirementChangeDto } from './dto/create-requirement-change.dto';
import { readRequirementRevision } from './requirement-change-context';

type ChangeAuthor = { user: { id: string; displayName: string }; organization?: { id?: string | null } | null };
const changeInclude = { restartWorkflowRun: { select: { id: true } } } as const;
type ChangeRow = RequirementChange & { restartWorkflowRun: { id: string } | null };

@Injectable()
export class RequirementChangesService {
  constructor(private readonly prisma: PrismaService, private readonly workflows: WorkflowService) {}

  async list(requirementId: string, workflowRunId?: string) {
    const requirement = await this.ensureRequirement(requirementId);
    await this.recoverExpiredStarts(requirementId);
    const changes = await this.prisma.requirementChange.findMany({ where: { requirementId }, orderBy: { revision: 'asc' }, include: changeInclude });
    const revision = changes.reduce((current, change) => Math.max(current, change.revision), requirement.revision);
    let contextRevision: number | undefined;
    if (workflowRunId) {
      const workflow = await this.prisma.workflowRun.findFirst({ where: { id: workflowRunId, requirementId }, include: { stageExecutions: { orderBy: { createdAt: 'desc' } } } });
      if (!workflow) throw new NotFoundException('关联工作流不存在。');
      const currentStages = workflow.currentStage ? workflow.stageExecutions.filter((stage) => stage.stage === workflow.currentStage) : workflow.stageExecutions;
      const consumed = currentStages[0];
      contextRevision = consumed?.status === 'PENDING' ? 0 : readRequirementRevision(consumed?.input);
    }
    return { revision, changes: changes.map((row) => this.response(row)), ...(contextRevision !== undefined ? { contextRevision, hasPendingChanges: contextRevision < revision } : {}) };
  }

  async create(requirementId: string, dto: CreateRequirementChangeDto, author?: ChangeAuthor) {
    if (!author?.user.id || !author.user.displayName) throw new ForbiddenException('请登录后提交需求变更。');
    const content = dto.content?.trim(); const requestId = dto.requestId?.trim();
    if (!content || content.length > 20000 || !requestId || requestId.length > 128 || !['SUPPLEMENT', 'RESTART'].includes(dto.mode)) throw new BadRequestException('请填写有效的变更说明和提交标识。');
    await this.ensureRequirement(requirementId);
    if (dto.sourceWorkflowRunId) {
      const source = await this.prisma.workflowRun.findFirst({ where: { id: dto.sourceWorkflowRunId, requirementId } });
      if (!source) throw new NotFoundException('关联工作流不存在或不属于当前需求。');
    }
    let record: ChangeRow | undefined;
    // SQLite 的事务重试只重跑数据库写入，绝不重跑工作流启动副作用。
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        record = await this.prisma.$transaction(async (tx) => {
          const existing = await tx.requirementChange.findUnique({ where: { requirementId_requestId: { requirementId, requestId } }, include: changeInclude });
          if (existing) {
            if (existing.content !== content || existing.mode !== dto.mode || existing.createdByUserId !== author.user.id || (dto.sourceWorkflowRunId && existing.sourceWorkflowRunId !== dto.sourceWorkflowRunId)) throw new ConflictException('该提交标识已用于其他变更，请刷新后重试。');
            return existing;
          }
          const latestSource = dto.mode === 'RESTART' && !dto.sourceWorkflowRunId ? await tx.workflowRun.findFirst({ where: { requirementId }, orderBy: { createdAt: 'desc' }, select: { id: true } }) : null;
          const updated = await tx.requirement.update({ where: { id: requirementId }, data: { revision: { increment: 1 } } });
          return tx.requirementChange.create({ data: {
            requirementId, revision: updated.revision, content, mode: dto.mode, requestId,
            createdByUserId: author.user.id, createdByName: author.user.displayName,
            sourceWorkflowRunId: dto.sourceWorkflowRunId ?? latestSource?.id,
            restartStatus: dto.mode === 'RESTART' ? 'PENDING' : 'NOT_REQUESTED',
          }, include: changeInclude });
        });
        break;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034', 'P2028', 'P1008'].includes(error.code) || attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
    if (!record) throw new ConflictException('变更正在提交，请稍后重试。');
    return dto.mode === 'RESTART' ? this.restart(requirementId, record.id) : this.response(record);
  }

  async restart(requirementId: string, changeId: string) {
    await this.ensureRequirement(requirementId);
    let record = await this.prisma.requirementChange.findFirst({ where: { id: changeId, requirementId }, include: changeInclude });
    if (!record) throw new NotFoundException('需求变更不存在。');
    if (record.mode !== 'RESTART') throw new BadRequestException('补充变更不能通过此入口重启流程。');
    if (record.restartStatus === 'STARTED') return this.response(record);
    const leaseExpired = new Date(Date.now() - 10 * 60_000);
    const leaseTime = new Date(Math.max(Date.now(), record.updatedAt.getTime() + 1));
    const claimed = await this.prisma.requirementChange.updateMany({ where: { id: changeId, requirementId, OR: [{ restartStatus: { in: ['PENDING', 'FAILED'] } }, { restartStatus: 'STARTING', updatedAt: { lt: leaseExpired } }] }, data: { restartStatus: 'STARTING', errorMessage: null, updatedAt: leaseTime } });
    if (claimed.count === 1) {
      try {
        await this.workflows.restartFromRequirementChange(changeId);
        await this.prisma.requirementChange.updateMany({ where: { id: changeId, restartStatus: 'STARTING', updatedAt: leaseTime }, data: { restartStatus: 'STARTED', errorMessage: null } });
      } catch (error) {
        const conflict = error instanceof BadRequestException || error instanceof ConflictException || (error instanceof Error && /活跃任务|仓库.*冲突/.test(error.message));
        await this.prisma.requirementChange.updateMany({ where: { id: changeId, restartStatus: 'STARTING', updatedAt: leaseTime }, data: {
          restartStatus: conflict ? 'PENDING' : 'FAILED',
          errorMessage: conflict ? '所选仓库仍有活跃任务，请结束当前任务后点击“继续启动流程”。' : '新一轮流程启动失败，请检查仓库连接和服务状态后重试。',
        } });
      }
    }
    record = await this.prisma.requirementChange.findFirstOrThrow({ where: { id: changeId, requirementId }, include: changeInclude });
    return this.response(record);
  }

  private async recoverExpiredStarts(requirementId: string) {
    const expired = await this.prisma.requirementChange.findMany({ where: { requirementId, restartStatus: 'STARTING', updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, include: { restartWorkflowRun: true } });
    for (const row of expired) {
      const started = row.restartWorkflowRun && !['CREATED', 'FAILED'].includes(row.restartWorkflowRun.status);
      await this.prisma.requirementChange.updateMany({ where: { id: row.id, restartStatus: 'STARTING', updatedAt: row.updatedAt }, data: {
        restartStatus: started ? 'STARTED' : 'FAILED',
        errorMessage: started ? null : '上次启动已中断，请点击“继续启动流程”恢复。',
      } });
    }
  }

  private async ensureRequirement(id: string) {
    const requirement = await this.prisma.requirement.findUnique({ where: { id } });
    if (!requirement) throw new NotFoundException('需求不存在或无权访问。');
    return requirement;
  }

  private response(row: ChangeRow) {
    return { id: row.id, requirementId: row.requirementId, revision: row.revision, content: row.content, mode: row.mode,
      createdByName: row.createdByName, createdAt: row.createdAt, sourceWorkflowRunId: row.sourceWorkflowRunId,
      restartWorkflowRunId: row.restartWorkflowRun?.id ?? null, restartStatus: row.restartStatus, errorMessage: row.errorMessage };
  }
}
