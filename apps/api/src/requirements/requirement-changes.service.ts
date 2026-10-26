import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RequirementChangePrototypeService } from './requirement-change-prototype.service';
import { readChangePrototype, type ChangePrototype } from './requirement-change-prototype';
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
  private readonly logger = new Logger(RequirementChangesService.name);
  constructor(private readonly prisma: PrismaService, private readonly workflows: WorkflowService,
    @Optional() private readonly prototypes?: RequirementChangePrototypeService) {}

  async createWithPrototype(requirementId: string, dto: CreateRequirementChangeDto & { aiProvider?: 'codex' | 'cursor' }, zip: Buffer, name: string, author?: ChangeAuthor) {
    if (!author?.user.id || !author.organization?.id) throw new ForbiddenException('请登录并选择组织。');
    if (dto.mode !== 'RESTART') throw new BadRequestException('更新原型请重新走流程。');
    const requirement = await this.ownedRequirement(requirementId, author);
    if (!zip.length || zip.length > 20 * 1024 * 1024) throw new BadRequestException('请选择不超过 20 MiB 的原型 ZIP。');
    if (!dto.requestId?.trim() || dto.requestId.length > 128 || (dto.aiProvider !== undefined && !['codex', 'cursor'].includes(dto.aiProvider))) throw new BadRequestException('提交标识或 AI 选择无效。');
    const content = dto.content?.trim() || `更新原型：${name}`;
    const sha256 = createHash('sha256').update(zip).digest('hex');
    const existing = await this.prisma.requirementChange.findUnique({ where: { requirementId_requestId: { requirementId, requestId: dto.requestId.trim() } }, include: changeInclude });
    if (existing) {
      const stored = readChangePrototype(existing.prototype);
      if (!stored || stored.sha256 !== sha256 || existing.content !== content || existing.createdByUserId !== author.user.id || (dto.aiProvider && dto.aiProvider !== stored.aiProvider) || (dto.sourceWorkflowRunId && dto.sourceWorkflowRunId !== existing.sourceWorkflowRunId)) throw new ConflictException('该提交标识已用于其他变更，请刷新后重试。');
      return this.restart(requirementId, existing.id);
    }
    if (dto.sourceWorkflowRunId && !await this.prisma.workflowRun.findFirst({ where: { id: dto.sourceWorkflowRunId, requirementId } })) throw new NotFoundException('关联工作流不存在。');
    if (!this.prototypes) throw new BadRequestException('原型导入服务暂不可用。');
    const source = await this.prisma.workflowRun.findFirst({ where: { requirementId, ...(dto.sourceWorkflowRunId ? { id: dto.sourceWorkflowRunId } : {}) }, orderBy: { createdAt: 'desc' } });
    const base = await this.prisma.prototypeImport.findUnique({ where: { requirementId } });
    const prototype = { ...await this.prototypes.store(zip, name, author.organization.id, dto.aiProvider ?? source?.aiProvider ?? base?.aiProvider ?? undefined), sha256 };
    try {
      return await this.create(requirement.id, { ...dto, content }, author, prototype);
    } finally {
      // 同键并发只保留真正落库的归档，不能删除已被变更引用的材料。
      const saved = await this.prisma.requirementChange.findUnique({ where: { requirementId_requestId: { requirementId, requestId: dto.requestId.trim() } } });
      if (readChangePrototype(saved?.prototype)?.archiveId !== prototype.archiveId) await this.prototypes.remove(prototype);
    }
  }

  async downloadPrototype(requirementId: string, changeId: string, author?: ChangeAuthor) {
    await this.ownedRequirement(requirementId, author);
    const row = await this.prisma.requirementChange.findFirst({ where: { id: changeId, requirementId } });
    const prototype = readChangePrototype(row?.prototype);
    if (!prototype || !this.prototypes) throw new NotFoundException('原型变更材料不存在。');
    return this.prototypes.download(prototype);
  }

  private async ownedRequirement(id: string, author?: ChangeAuthor) {
    if (!author?.user.id || !author.organization?.id) throw new ForbiddenException('请登录并选择组织。');
    const row = await this.prisma.requirement.findFirst({ where: { id, project: { workspace: { organizationId: author.organization.id } } } });
    if (!row) throw new NotFoundException('需求不存在或无权访问。');
    return row;
  }

  async list(requirementId: string, workflowRunId?: string, author?: ChangeAuthor) {
    const requirement = author ? await this.ownedRequirement(requirementId, author) : await this.ensureRequirement(requirementId);
    await this.recoverExpiredStarts(requirementId);
    const changes = await this.prisma.requirementChange.findMany({ where: { requirementId }, orderBy: { revision: 'asc' }, include: changeInclude });
    const revision = changes.reduce((current, change) => Math.max(current, change.revision), requirement.revision);
    const preferred = await this.prisma.workflowRun.findFirst({ where: { requirementId, ...(workflowRunId ? { id: workflowRunId } : {}) }, orderBy: { createdAt: 'desc' }, select: { aiProvider: true } });
    const base = preferred ? null : await this.prisma.prototypeImport.findUnique({ where: { requirementId }, select: { aiProvider: true } });
    const selectedAi = preferred?.aiProvider ?? base?.aiProvider;
    const aiProvider = selectedAi === 'codex' || selectedAi === 'cursor' ? selectedAi : undefined;
    let contextRevision: number | undefined;
    if (workflowRunId) {
      const workflow = await this.prisma.workflowRun.findFirst({ where: { id: workflowRunId, requirementId }, include: { stageExecutions: { orderBy: { createdAt: 'desc' } } } });
      if (!workflow) throw new NotFoundException('关联工作流不存在。');
      const currentStages = workflow.currentStage ? workflow.stageExecutions.filter((stage) => stage.stage === workflow.currentStage) : workflow.stageExecutions;
      const consumed = currentStages[0];
      contextRevision = consumed?.status === 'PENDING' ? 0 : readRequirementRevision(consumed?.input);
    }
    return { revision, aiProvider, changes: changes.map((row) => this.response(row)), ...(contextRevision !== undefined ? { contextRevision, hasPendingChanges: contextRevision < revision } : {}) };
  }

  async create(requirementId: string, dto: CreateRequirementChangeDto, author?: ChangeAuthor, prototype?: ChangePrototype) {
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
            if (!!existing.prototype !== !!prototype || (prototype && (readChangePrototype(existing.prototype)?.sha256 !== prototype.sha256 || readChangePrototype(existing.prototype)?.aiProvider !== prototype.aiProvider)) || existing.content !== content || existing.mode !== dto.mode || existing.createdByUserId !== author.user.id || (dto.sourceWorkflowRunId && existing.sourceWorkflowRunId !== dto.sourceWorkflowRunId)) throw new ConflictException('该提交标识已用于其他变更，请刷新后重试。');
            return existing;
          }
          const latestSource = dto.mode === 'RESTART' && !dto.sourceWorkflowRunId ? await tx.workflowRun.findFirst({ where: { requirementId }, orderBy: { createdAt: 'desc' }, select: { id: true } }) : null;
          const updated = await tx.requirement.update({ where: { id: requirementId }, data: { revision: { increment: 1 } } });
          return tx.requirementChange.create({ data: {
            requirementId, revision: updated.revision, content, mode: dto.mode, requestId,
            createdByUserId: author.user.id, createdByName: author.user.displayName,
            sourceWorkflowRunId: dto.sourceWorkflowRunId ?? latestSource?.id,
            restartStatus: dto.mode === 'RESTART' ? 'PENDING' : 'NOT_REQUESTED',
            ...(prototype ? { prototype: JSON.parse(JSON.stringify(prototype)) as Prisma.InputJsonValue } : {}),
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

  async restart(requirementId: string, changeId: string, author?: ChangeAuthor) {
    if (author) await this.ownedRequirement(requirementId, author);
    else await this.ensureRequirement(requirementId);
    let record = await this.prisma.requirementChange.findFirst({ where: { id: changeId, requirementId }, include: changeInclude });
    if (!record) throw new NotFoundException('需求变更不存在。');
    if (record.mode !== 'RESTART') throw new BadRequestException('补充变更不能通过此入口重启流程。');
    if (record.restartStatus === 'STARTED') return this.response(record);
    const leaseExpired = new Date(Date.now() - 10 * 60_000);
    const leaseTime = new Date(Math.max(Date.now(), record.updatedAt.getTime() + 1));
    const claimed = await this.prisma.requirementChange.updateMany({ where: { id: changeId, requirementId, OR: [{ restartStatus: { in: ['PENDING', 'FAILED'] } }, { restartStatus: 'STARTING', updatedAt: { lt: leaseExpired } }] }, data: { restartStatus: 'STARTING', errorMessage: null, updatedAt: leaseTime } });
    if (claimed.count === 1) {
      if (record.prototype) {
        setTimeout(() => { void this.finishRestart(record!, leaseTime).catch(() => undefined); }, 0);
      } else await this.finishRestart(record, leaseTime);
    }
    record = await this.prisma.requirementChange.findFirstOrThrow({ where: { id: changeId, requirementId }, include: changeInclude });
    return this.response(record);
  }

  private async finishRestart(record: ChangeRow, leaseTime: Date) {
    let analyzing = false;
    try {
      const prototype = readChangePrototype(record.prototype);
      if (prototype && !prototype.snapshot) {
        analyzing = true;
        if (!this.prototypes) throw new Error('PROTOTYPE_ANALYSIS_UNAVAILABLE');
        const requirement = await this.prisma.requirement.findUniqueOrThrow({ where: { id: record.requirementId }, include: { project: { include: { workspace: true } } } });
        const snapshot = await this.prototypes.analyze(prototype, record.content, { user: { id: record.createdByUserId, displayName: record.createdByName }, organization: { id: requirement.project.workspace.organizationId } });
        const saved = await this.prisma.requirementChange.updateMany({ where: { id: record.id, restartStatus: 'STARTING', updatedAt: leaseTime }, data: { prototype: JSON.parse(JSON.stringify({ ...prototype, snapshot })) as Prisma.InputJsonValue, updatedAt: leaseTime } });
        if (saved.count !== 1) return;
        analyzing = false;
      }
      const current = await this.prisma.requirementChange.findFirst({ where: { id: record.id, restartStatus: 'STARTING', updatedAt: leaseTime } });
      if (!current) return;
      await this.workflows.restartFromRequirementChange(record.id);
      await this.prisma.requirementChange.updateMany({ where: { id: record.id, restartStatus: 'STARTING', updatedAt: leaseTime }, data: { restartStatus: 'STARTED', errorMessage: null } });
    } catch (error) {
      const conflict = !analyzing && (error instanceof BadRequestException || error instanceof ConflictException || (error instanceof Error && /活跃任务|仓库.*冲突/.test(error.message)));
      this.logger.warn(`REQUIREMENT_CHANGE_RESTART_FAILED id=${record.id} reason=${analyzing ? 'AI_ANALYSIS_FAILED' : 'WORKFLOW_HANDOFF_FAILED'}`);
      await this.prisma.requirementChange.updateMany({ where: { id: record.id, restartStatus: 'STARTING', updatedAt: leaseTime }, data: {
        restartStatus: conflict ? 'PENDING' : 'FAILED',
        errorMessage: analyzing ? 'AI 整理新原型失败，ZIP 和原流程已保留。请检查 AI 凭证后继续启动流程。'
          : conflict ? '所选仓库仍有活跃任务，请结束当前任务后点击“继续启动流程”。' : '新一轮流程启动失败，请检查仓库连接和服务状态后重试。',
      } });
    }
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
    const prototype = readChangePrototype(row.prototype);
    return { id: row.id, requirementId: row.requirementId, revision: row.revision, content: row.content, mode: row.mode,
      createdByName: row.createdByName, createdAt: row.createdAt, sourceWorkflowRunId: row.sourceWorkflowRunId,
      prototype: prototype ? { name: prototype.name, aiProvider: prototype.aiProvider } : null,
      restartWorkflowRunId: row.restartWorkflowRun?.id ?? null, restartStatus: row.restartStatus, errorMessage: row.errorMessage };
  }
}
