import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { FLOWX_PROTOCOL_VERSION, type ExecutionSessionStatus } from '@flowx-ai/protocol';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pageResult, parsePagination } from '../common/pagination';
import { AI_EXECUTOR_REGISTRY, type AIExecutorRegistry } from '../ai/ai-executor';
import { AiInvocationContextService } from '../ai/ai-invocation-context.service';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { CreateExecutionItemDto } from './dto/create-execution-item.dto';
import { GenerateExecutionPlanDto } from './dto/generate-execution-plan.dto';
import { ListWorkItemsDto } from './dto/list-work-items.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';
import { WorkflowService } from '../workflow/workflow.service';
import { assertExecutionSessionTransition } from '../execution-sessions/execution-session-state';
import { reserveWorkItemDisplayCode } from './work-item-identifier.service';

type AuthSession = { user?: { id?: string; displayName?: string }; organization?: { id?: string | null } | null };

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class WorkItemsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WorkflowService) private readonly workflowService: WorkflowService,
    @Optional() @Inject(AI_EXECUTOR_REGISTRY) private readonly aiExecutorRegistry?: AIExecutorRegistry,
    @Optional() private readonly aiInvocationContextService?: AiInvocationContextService,
  ) {}

  async listByVersion(projectId: string, versionId: string, query: ListWorkItemsDto, auth?: AuthSession) {
    await this.assertProjectVersion(projectId, versionId, auth);
    const requestedPageSize = Number.isFinite(query.pageSize) ? query.pageSize! : PAGE_SIZE;
    const take = Math.min(Math.max(requestedPageSize, 1), MAX_PAGE_SIZE);
    const cursor = this.decodeCursor(query.cursor);
    const filters: Prisma.WorkItemWhereInput[] = [];
    if (query.q?.trim()) {
      const keyword = query.q.trim();
      filters.push({ OR: [{ title: { contains: keyword } }, { description: { contains: keyword } }, { displayCode: { contains: keyword } }] });
    }
    if (cursor) {
      filters.push({ OR: [
        { updatedAt: { lt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
      ] });
    }
    const where: Prisma.WorkItemWhereInput = {
      projectId,
      versionId,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.planningStatus ? { planningStatus: query.planningStatus } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.ownerId ? { ownerUserId: query.ownerId } : {}),
      ...(filters.length ? { AND: filters } : {}),
    };
    const rows = await this.prisma.workItem.findMany({
      where,
      take: take + 1,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        ownerUser: { select: { id: true, displayName: true, avatarUrl: true } },
        executionPlans: { take: 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } },
        _count: { select: { workflowRuns: true, executionPlans: true } },
      },
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt.toISOString(), id: last.id }), 'utf8').toString('base64url') : null,
    };
  }

  async listGlobal(query: ListWorkItemsDto, auth?: AuthSession) {
    const paging = parsePagination({ page: query.page, pageSize: query.pageSize });
    const where: Prisma.WorkItemWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.planningStatus ? { planningStatus: query.planningStatus } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.ownerId ? { ownerUserId: query.ownerId } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.versionId ? { versionId: query.versionId } : {}),
      ...(query.q?.trim() ? { OR: [{ title: { contains: query.q.trim() } }, { description: { contains: query.q.trim() } }, { displayCode: { contains: query.q.trim() } }] } : {}),
    };
    if (auth?.organization?.id) {
      where.workspace = { organizationId: auth.organization.id };
    }
    const [items, total] = await Promise.all([
      this.prisma.workItem.findMany({
        where,
        skip: paging.skip,
        take: paging.take,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        include: {
          project: { select: { id: true, name: true } },
          version: { select: { id: true, name: true } },
          workspace: { select: { id: true, name: true } },
          ownerUser: { select: { id: true, displayName: true, avatarUrl: true } },
          sourceWorkflowRun: true,
          executionPlans: { take: 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } },
        },
      }),
      this.prisma.workItem.count({ where }),
    ]);
    return pageResult(items, total, paging);
  }

  async create(projectId: string, versionId: string, dto: CreateWorkItemDto, auth?: AuthSession) {
    const project = await this.assertProjectVersion(projectId, versionId, auth);
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('请填写工作项标题。');
    if (dto.ownerUserId) await this.assertUserInOrganization(dto.ownerUserId, project.workspace.organizationId);
    const repositoryIds = Array.from(new Set((dto.repositoryIds ?? []).map((value) => value.trim()).filter(Boolean)));
    const allowedRepositoryIds = new Set(project.workspace.repositories.map((repository) => repository.id));
    const invalidRepositoryIds = repositoryIds.filter((repositoryId) => !allowedRepositoryIds.has(repositoryId));
    if (invalidRepositoryIds.length) throw new NotFoundException('仓库不属于当前项目工作区。');
    const splitMode = dto.splitMode ?? 'SINGLE';
    const created = await this.prisma.$transaction(async (tx) => {
      const displayCode = await reserveWorkItemDisplayCode(tx, projectId, dto.kind);
      const item = await tx.workItem.create({
        data: {
          displayCode,
          projectId,
          versionId,
          workspaceId: project.workspaceId,
          kind: dto.kind,
          status: dto.kind === 'ISSUE' || dto.kind === 'BUG' ? 'OPEN' : 'ACTIVE',
          title,
          description: dto.description?.trim() ?? '',
          remark: dto.remark?.trim() ?? '',
          priority: dto.priority?.trim() || 'MEDIUM',
          functionalModule: dto.functionalModule?.trim() ?? '',
          riskImpact: dto.riskImpact?.trim() ?? '',
          productRequirementDocument: dto.productRequirementDocument?.trim() ?? '',
          planningStatus: dto.planningStatus?.trim() || 'UNSCHEDULED',
          resolution: dto.resolution?.trim() || null,
          severity: dto.severity?.trim() || null,
          expectedBehavior: dto.expectedBehavior?.trim() || null,
          actualBehavior: dto.actualBehavior?.trim() || null,
          branchName: dto.branchName?.trim() || null,
          ownerUserId: dto.ownerUserId || null,
          createdByUserId: auth?.user?.id || null,
          acceptanceCriteria: dto.acceptanceCriteria?.trim() ?? '',
          ...(repositoryIds.length && dto.kind === 'REQUIREMENT' ? { requirementRepositories: { create: repositoryIds.map((repositoryId) => ({ repositoryId })) } } : {}),
        },
      });
      const plan = await tx.executionPlan.create({
        data: {
          workItemId: item.id,
          status: splitMode === 'AI' || splitMode === 'MANUAL' ? 'DRAFT' : 'CONFIRMED',
          strategy: splitMode,
          createdByUserId: auth?.user?.id || null,
          items: splitMode === 'SINGLE' ? { create: { title, description: dto.description?.trim() ?? '', target: 'LOCAL', ownerUserId: dto.ownerUserId || null, status: 'READY' } } : undefined,
        },
        include: { items: true },
      });
      return { itemId: item.id, planId: plan.id };
    });
    return this.findOne(created.itemId, auth, created.planId);
  }

  async findOne(id: string, auth?: AuthSession, planId?: string) {
    const item = await this.prisma.workItem.findUnique({
      where: { id },
      include: {
        project: { include: { workspace: true } },
        version: { select: { id: true, name: true } },
        ownerUser: { select: { id: true, displayName: true, avatarUrl: true } },
        workflowRuns: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
        requirementRepositories: { include: { repository: true }, orderBy: { createdAt: 'asc' } },
        assignments: { include: { user: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        ideationSessions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        ideationArtifacts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        prototypeImport: true,
        changes: { orderBy: [{ revision: 'desc' }, { id: 'desc' }] },
        executionPlans: { where: planId ? { id: planId } : undefined, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } },
      },
    });
    if (!item) throw new NotFoundException('工作项不存在。');
    this.assertOrganization(item.project.workspace.organizationId, auth);
    return item;
  }

  async update(id: string, dto: UpdateWorkItemDto, auth?: AuthSession) {
    const existing = await this.findOne(id, auth);
    if (dto.versionId !== undefined && dto.versionId !== existing.versionId) {
      if (dto.versionId) await this.assertProjectVersion(existing.projectId, dto.versionId, auth);
    }
    if (dto.ownerUserId) await this.assertUserInOrganization(dto.ownerUserId, existing.project.workspace.organizationId);
    if (dto.title !== undefined && !dto.title.trim()) throw new BadRequestException('请填写工作项标题。');
    if (dto.updatedAt && Number.isNaN(Date.parse(dto.updatedAt))) {
      throw new BadRequestException('updatedAt 无效。');
    }
    const updated = await this.prisma.workItem.updateMany({
      where: { id, ...(dto.updatedAt ? { updatedAt: new Date(dto.updatedAt) } : {}) },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.remark !== undefined ? { remark: dto.remark.trim() } : {}),
        ...(dto.status !== undefined ? { status: dto.status.trim() } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority.trim() } : {}),
        ...(dto.acceptanceCriteria !== undefined ? { acceptanceCriteria: dto.acceptanceCriteria.trim() } : {}),
        ...(dto.functionalModule !== undefined ? { functionalModule: dto.functionalModule.trim() } : {}),
        ...(dto.riskImpact !== undefined ? { riskImpact: dto.riskImpact.trim() } : {}),
        ...(dto.productRequirementDocument !== undefined ? { productRequirementDocument: dto.productRequirementDocument.trim() } : {}),
        ...(dto.planningStatus !== undefined ? { planningStatus: dto.planningStatus.trim() } : {}),
        ...(dto.resolution !== undefined ? { resolution: dto.resolution.trim() || null } : {}),
        ...(dto.severity !== undefined ? { severity: dto.severity.trim() || null } : {}),
        ...(dto.expectedBehavior !== undefined ? { expectedBehavior: dto.expectedBehavior.trim() || null } : {}),
        ...(dto.actualBehavior !== undefined ? { actualBehavior: dto.actualBehavior.trim() || null } : {}),
        ...(dto.branchName !== undefined ? { branchName: dto.branchName.trim() || null } : {}),
        ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {}),
        ...(dto.versionId !== undefined ? { versionId: dto.versionId } : {}),
      },
    });
    if (updated.count !== 1) throw new ConflictException('工作项已被其他人更新，请刷新后重试。');
    return this.prisma.workItem.findUniqueOrThrow({
      where: { id },
      include: { ownerUser: { select: { id: true, displayName: true, avatarUrl: true } }, version: { select: { id: true, name: true } } },
    });
  }

  async confirmPlan(id: string, planId: string, auth?: AuthSession) {
    await this.findOne(id, auth);
    const plan = await this.prisma.executionPlan.findFirst({ where: { id: planId, workItemId: id }, include: { items: true } });
    if (!plan) throw new NotFoundException('执行计划不存在。');
    if (plan.status !== 'DRAFT') throw new ConflictException('执行计划已经确认或不可确认。');
    if (!plan.items.length) throw new BadRequestException('请先添加至少一个执行项。');
    if (!plan.items.some((item) => item.required)) throw new BadRequestException('执行计划至少需要一个必需执行项。');
    this.validateExecutionItemDependencies(plan.items);
    return this.prisma.executionPlan.update({ where: { id: planId }, data: { status: 'CONFIRMED' }, include: { items: true } });
  }

  async generateExecutionPlan(id: string, planId: string, dto: GenerateExecutionPlanDto, auth?: AuthSession) {
    const item = await this.findOne(id, auth, planId);
    const plan = item.executionPlans.find((candidate) => candidate.id === planId);
    if (!plan) throw new NotFoundException('执行计划不存在。');
    if (plan.status !== 'DRAFT') throw new ConflictException('执行计划已经确认，不能重新生成。');
    if (plan.items.length) throw new ConflictException('执行计划已有执行项，请先清空后再生成。');
    if (!this.aiExecutorRegistry || !this.aiInvocationContextService) {
      throw new BadRequestException('当前服务未启用 AI 执行器。');
    }
    const organizationId = item.project?.workspace?.organizationId;
    const provider = await this.aiInvocationContextService.resolveOnlineProvider(organizationId, dto.aiProvider);
    const context = await this.aiInvocationContextService.resolveInvocationContext(provider, {
      flowxUserId: auth?.user?.id ?? 'system',
      displayName: auth?.user?.displayName ?? 'FlowX',
      flowxOrganizationId: organizationId,
    });
    const specPlan = await this.aiExecutorRegistry.get(provider).generateSpecPlan({
      workItem: {
        id: item.id,
        title: item.title,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria,
      },
      workspace: null,
    }, context);
    const suggestion = await this.aiExecutorRegistry.get(provider).splitExecutionPlan({
      workItem: {
        id: item.id,
        title: item.title,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria,
      },
      specPlan,
      workspace: null,
    }, context);
    if (!suggestion.items.length) throw new BadRequestException('AI 未生成可执行的拆解建议，请改用人工拆解。');
    const generated = await this.prisma.$transaction(async (tx) => {
      const createdItems = [] as Array<{ id: string }>;
      for (const [index, entry] of suggestion.items.entries()) {
        const dependencies = entry.dependsOnIndexes.map(Number);
        if (dependencies.some((dependency) => !Number.isInteger(dependency) || dependency < 0 || dependency >= index)) {
          throw new BadRequestException(`AI 拆解的执行项「${entry.title}」包含无效的前置依赖。`);
        }
        if (new Set(dependencies).size !== dependencies.length) {
          throw new BadRequestException(`AI 拆解的执行项「${entry.title}」包含重复依赖。`);
        }
        const created = await tx.executionItem.create({ data: {
          executionPlanId: planId,
          title: entry.title.trim(),
          description: entry.description.trim(),
          target: entry.target.trim() || 'LOCAL',
          ownerHint: entry.ownerHint?.trim() || null,
          ownerUserId: null,
          required: entry.required,
          status: 'READY',
          verification: entry.verification.join('\n'),
          dependsOnIds: [],
          sortOrder: index,
        } });
        createdItems.push(created);
      }
      for (const [index, entry] of suggestion.items.entries()) {
        const dependencies = entry.dependsOnIndexes.map((dependency) => createdItems[dependency]!.id);
        if (dependencies.length) await tx.executionItem.update({ where: { id: createdItems[index]!.id }, data: { dependsOnIds: dependencies } });
      }
      return tx.executionPlan.findUniqueOrThrow({
        where: { id: planId },
        include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      });
    });
    return generated;
  }

  async addExecutionItem(id: string, planId: string, dto: CreateExecutionItemDto, auth?: AuthSession) {
    const item = await this.findOne(id, auth);
    const plan = item.executionPlans.find((candidate) => candidate.id === planId);
    if (!plan) throw new NotFoundException('执行计划不存在。');
    if (plan.status !== 'DRAFT') throw new ConflictException('执行计划已确认，不能继续修改。');
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('请填写执行项标题。');
    if (dto.ownerUserId) await this.assertUserInOrganization(dto.ownerUserId, item.project.workspace.organizationId);
    const dependencies = Array.from(new Set((dto.dependsOnIds ?? []).map((value) => value.trim()).filter(Boolean)));
    this.validateExecutionItemDependencies([
      ...plan.items,
      { id: '__new_execution_item__', title, required: dto.required ?? true, dependsOnIds: dependencies },
    ]);
    return this.prisma.executionItem.create({
      data: {
        executionPlanId: planId,
        title,
        description: dto.description?.trim() ?? '',
        target: dto.target?.trim() || 'LOCAL',
        ownerHint: dto.ownerHint?.trim() || null,
        ownerUserId: dto.ownerUserId || null,
        required: dto.required ?? true,
        dependsOnIds: dependencies,
        verification: dto.verification?.trim() || '',
        sortOrder: dto.sortOrder ?? plan.items.length,
      },
    });
  }

  async remove(id: string, auth?: AuthSession) {
    const item = await this.findOne(id, auth);
    const activeWorkflow = item.workflowRuns.some((workflow) => !['DONE', 'FAILED'].includes(workflow.status));
    if (activeWorkflow) throw new ConflictException('工作项仍有进行中的工作流，不能删除。');
    const unfinished = item.executionPlans.some((plan) => plan.items.some((executionItem) => !['COMPLETED', 'CANCELLED'].includes(executionItem.status)));
    if (unfinished) throw new ConflictException('请先完成或取消所有执行项后再删除工作项。');
    return this.prisma.workItem.delete({ where: { id } });
  }

  async startWorkflow(id: string, input: { repositoryIds?: string[]; aiProvider?: string; splitMode?: 'AI' | 'SINGLE' | 'MANUAL' }, auth?: AuthSession) {
    const item = await this.findOne(id, auth);
    const pendingPlans = item.executionPlans.filter((candidate) => !candidate.workflowRunId);
    let plan = pendingPlans[0];
    const splitMode: 'AI' | 'SINGLE' | 'MANUAL' = input.splitMode ??
      (plan?.strategy === 'AI' || plan?.strategy === 'MANUAL' ? plan.strategy : 'SINGLE');
    if (plan && plan.strategy !== splitMode) {
      throw new ConflictException(`当前执行计划策略为 ${plan.strategy}，不能以 ${splitMode} 启动。请先调整执行计划。`);
    }
    if (!plan) {
      if (splitMode !== 'SINGLE') {
        throw new ConflictException('AI 或人工拆解必须先建立并确认执行计划。');
      }
      plan = await this.prisma.executionPlan.create({
        data: {
          workItemId: id,
          status: 'CONFIRMED',
          strategy: 'SINGLE',
          createdByUserId: auth?.user?.id || null,
          items: { create: { title: item.title, description: item.description, target: 'LOCAL', ownerUserId: item.ownerUserId, status: 'READY' } },
        },
        include: { items: true },
      });
    }
    if (plan.status === 'DRAFT') throw new ConflictException('请先确认执行计划，再启动工作流。');
    if (!plan.items.length) throw new BadRequestException('执行计划至少需要一个执行项。');
    if (splitMode === 'SINGLE' && plan.items.length !== 1) {
      throw new ConflictException('SINGLE 策略只能包含一个执行项，请改用 AI 或 MANUAL 策略。');
    }
    const workflow = await this.workflowService.createWorkflowRun({ workItemId: id, repositoryIds: input.repositoryIds, aiProvider: input.aiProvider, splitMode });
    await this.prisma.executionPlan.update({ where: { id: plan.id }, data: { workflowRunId: workflow.id } });
    return workflow;
  }

  async claimExecutionItem(executionItemId: string, input: { userId: string; claimKey: string }, auth?: AuthSession) {
    if (!input.userId || !input.claimKey) throw new BadRequestException('userId 和 claimKey 必填。');
    const item = await this.prisma.executionItem.findUnique({ where: { id: executionItemId }, include: { executionPlan: { include: { workItem: { include: { project: { include: { workspace: true } } } } } } } });
    if (!item) throw new NotFoundException('执行项不存在。');
    this.assertOrganization(item.executionPlan.workItem.project.workspace.organizationId, auth);
    await this.assertUserInOrganization(input.userId, item.executionPlan.workItem.project.workspace.organizationId);
    if (item.executionPlan.workflowRunId) {
      const workflow = await this.prisma.workflowRun?.findUnique({ where: { id: item.executionPlan.workflowRunId }, select: { status: true } });
      if (workflow?.status === 'EXECUTION_PENDING') {
        const claimed = await this.workflowService.claimLocalExecution(
          item.executionPlan.workflowRunId,
          {
            user: { id: input.userId, displayName: auth?.user?.displayName ?? input.userId },
            organization: { id: item.executionPlan.workItem.project.workspace.organizationId },
          },
          'flowx-local',
          input.claimKey,
          executionItemId,
        );
        return {
          ...(await this.prisma.executionItem.findUniqueOrThrow({ where: { id: executionItemId } })),
          executionSessionId: claimed.handoff.executionSessionId,
        };
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.executionItem.findUnique({ where: { id: executionItemId }, include: { executionPlan: { include: { workItem: { include: { project: { include: { workspace: true } } } } } } } });
      if (!current) throw new NotFoundException('执行项不存在。');
      const sameClaim = current.claimKey === input.claimKey;
      if (sameClaim) {
        if (current.ownerUserId !== input.userId || current.status !== 'IN_PROGRESS') {
          throw new ConflictException('执行项已由其他领取者处理。');
        }
        const existingSession = await tx.executionSession.findFirst({ where: { executionItemId, OR: [
          { idempotencyKey: `execution-item-claim:${executionItemId}:${input.claimKey}` },
          { idempotencyKey: input.claimKey },
        ] }, select: { id: true } });
        if (existingSession) return { ...current, executionSessionId: existingSession.id };
      }
      if (current.executionPlan.status !== 'CONFIRMED' || !current.executionPlan.workflowRunId) {
        throw new ConflictException('执行计划尚未确认或尚未启动工作流。');
      }
      if (!sameClaim && (current.status !== 'READY' || (current.ownerUserId && current.ownerUserId !== input.userId))) {
        throw new ConflictException('执行项已被其他人领取或已开始执行。');
      }
      if (!sameClaim) {
        const dependencies = Array.isArray(current.dependsOnIds) ? current.dependsOnIds.map(String) : [];
        if (dependencies.length) {
          const dependencyRows = await tx.executionItem.findMany({ where: { id: { in: dependencies } }, select: { id: true, status: true } });
          if (dependencyRows.length !== dependencies.length || dependencyRows.some((dependency) => dependency.status !== 'COMPLETED')) {
            throw new ConflictException('执行项依赖尚未全部完成。');
          }
        }
        const updated = await tx.executionItem.updateMany({
          where: { id: executionItemId, status: 'READY', OR: [{ ownerUserId: null }, { ownerUserId: input.userId }] },
          data: { ownerUserId: input.userId, claimKey: input.claimKey, claimedAt: new Date(), status: 'IN_PROGRESS' },
        });
        if (updated.count !== 1) throw new ConflictException('执行项已被其他人领取。');
      }
      const stageExecution = await tx.stageExecution.findFirst({ where: { workflowRunId: current.executionPlan.workflowRunId, stage: 'EXECUTION' }, orderBy: { attempt: 'desc' } });
      const executionSession = await tx.executionSession.create({
        data: {
          id: randomUUID(),
          workflowRunId: current.executionPlan.workflowRunId,
          stageExecutionId: stageExecution?.id ?? null,
          executionItemId,
          organizationId: current.executionPlan.workItem.project.workspace.organizationId,
          workspaceId: current.executionPlan.workItem.project.workspaceId,
          projectId: current.executionPlan.workItem.projectId,
          status: 'RUNNING',
          executorType: 'LOCAL',
          sourceTool: 'flowx-local',
          protocolVersion: FLOWX_PROTOCOL_VERSION,
          traceId: randomUUID(),
          idempotencyKey: `execution-item-claim:${executionItemId}:${input.claimKey}`,
          claimedByUserId: input.userId,
          startedAt: new Date(),
          lastHeartbeatAt: new Date(),
          metadata: { claimSource: 'execution-item.claim' },
        },
      });
      const claimed = await tx.executionItem.findUniqueOrThrow({ where: { id: executionItemId } });
      return { ...claimed, executionSessionId: executionSession.id };
    });
  }

  async completeExecutionItem(executionItemId: string, input: { userId: string; claimKey: string; summary?: string; evidence?: Record<string, unknown> }, auth?: AuthSession) {
    if (!input.userId || !input.claimKey) throw new BadRequestException('userId 和 claimKey 必填。');
    const item = await this.prisma.executionItem.findUnique({ where: { id: executionItemId }, include: { executionPlan: { include: { workItem: { include: { project: { include: { workspace: true } } } } } } } });
    if (!item) throw new NotFoundException('执行项不存在。');
    this.assertOrganization(item.executionPlan.workItem.project.workspace.organizationId, auth);
    if (item.status === 'COMPLETED' && item.claimKey === input.claimKey) return item;
    if (item.executionPlan.status !== 'CONFIRMED' || !item.executionPlan.workflowRunId) {
      throw new ConflictException('执行计划尚未确认或尚未启动工作流。');
    }
    if (item.ownerUserId !== input.userId || item.claimKey !== input.claimKey) throw new ForbiddenException('只有当前领取者可以完成执行项。');
    const completed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.executionItem.updateMany({
        where: { id: executionItemId, status: 'IN_PROGRESS', ownerUserId: input.userId, claimKey: input.claimKey },
        data: { status: 'COMPLETED', completedAt: new Date(), completionSummary: input.summary?.trim() || null, ...(input.evidence ? { completionEvidence: input.evidence as Prisma.InputJsonValue } : {}) },
      });
      if (updated.count !== 1) throw new ConflictException('执行项状态已变化，请重新读取。');
      await this.updateExecutionItemSession(tx, executionItemId, 'COMPLETED', input.summary?.trim() || null);
      return tx.executionItem.findUniqueOrThrow({ where: { id: executionItemId } });
    });
    if (item.executionPlan.workflowRunId) {
      await this.workflowService.advanceExecutionPlanIfComplete(item.executionPlan.workflowRunId);
    }
    return completed;
  }

  async blockExecutionItem(executionItemId: string, input: { userId: string; claimKey: string; reason: string }, auth?: AuthSession) {
    if (!input.userId || !input.claimKey || !input.reason?.trim()) throw new BadRequestException('userId、claimKey 和 reason 必填。');
    const item = await this.prisma.executionItem.findUnique({ where: { id: executionItemId }, include: { executionPlan: { include: { workItem: { include: { project: { include: { workspace: true } } } } } } } });
    if (!item) throw new NotFoundException('执行项不存在。');
    this.assertOrganization(item.executionPlan.workItem.project.workspace.organizationId, auth);
    if (item.executionPlan.status !== 'CONFIRMED' || !item.executionPlan.workflowRunId) throw new ConflictException('执行计划尚未确认或尚未启动工作流。');
    if (item.status === 'BLOCKED' && item.claimKey === input.claimKey) return item;
    if (item.status !== 'IN_PROGRESS' || item.ownerUserId !== input.userId || item.claimKey !== input.claimKey) throw new ForbiddenException('只有当前领取者可以阻塞执行项。');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.executionItem.updateMany({ where: { id: executionItemId, status: 'IN_PROGRESS', ownerUserId: input.userId, claimKey: input.claimKey }, data: { status: 'BLOCKED', blockedReason: input.reason.trim() } });
      if (updated.count !== 1) throw new ConflictException('执行项状态已变化，请重新读取。');
      await this.updateExecutionItemSession(tx, executionItemId, 'BLOCKED', input.reason.trim());
      return tx.executionItem.findUniqueOrThrow({ where: { id: executionItemId } });
    });
  }

  async cancelExecutionItem(executionItemId: string, input: { userId: string; claimKey?: string; reason: string }, auth?: AuthSession) {
    if (!input.userId || !input.reason?.trim()) throw new BadRequestException('userId 和 reason 必填。');
    const item = await this.prisma.executionItem.findUnique({ where: { id: executionItemId }, include: { executionPlan: { include: { workItem: { include: { project: { include: { workspace: true } } } } } } } });
    if (!item) throw new NotFoundException('执行项不存在。');
    this.assertOrganization(item.executionPlan.workItem.project.workspace.organizationId, auth);
    if (item.executionPlan.status !== 'CONFIRMED' || !item.executionPlan.workflowRunId) throw new ConflictException('执行计划尚未确认或尚未启动工作流。');
    if (item.status === 'CANCELLED') return item;
    if (item.status === 'IN_PROGRESS' && (item.ownerUserId !== input.userId || item.claimKey !== input.claimKey)) throw new ForbiddenException('只有当前领取者可以取消执行项。');
    if (!['READY', 'IN_PROGRESS', 'BLOCKED'].includes(item.status)) throw new ConflictException('当前状态不能取消。');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.executionItem.updateMany({ where: { id: executionItemId, status: item.status }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: input.reason.trim() } });
      if (updated.count !== 1) throw new ConflictException('执行项状态已变化，请重新读取。');
      await this.updateExecutionItemSession(tx, executionItemId, 'CANCELLED', input.reason.trim());
      return tx.executionItem.findUniqueOrThrow({ where: { id: executionItemId } });
    });
  }

  private async updateExecutionItemSession(tx: Prisma.TransactionClient, executionItemId: string, status: 'COMPLETED' | 'BLOCKED' | 'CANCELLED', summary: string | null) {
    const sessions = await tx.executionSession.findMany({ where: { executionItemId, status: { in: ['RUNNING', 'BLOCKED'] } }, select: { id: true, status: true } });
    for (const session of sessions) {
      assertExecutionSessionTransition(session.status as ExecutionSessionStatus, status);
      await tx.executionSession.update({
        where: { id: session.id },
        data: { status, summary, ...(status === 'COMPLETED' || status === 'CANCELLED' ? { completedAt: new Date() } : {}) },
      });
    }
  }

  private decodeCursor(value?: string) {
    if (!value) return null;
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { updatedAt?: string; id?: string };
      if (!parsed.updatedAt || !parsed.id) throw new Error('invalid');
      const date = new Date(parsed.updatedAt);
      if (Number.isNaN(date.valueOf())) throw new Error('invalid');
      return { updatedAt: date, id: parsed.id };
    } catch {
      throw new BadRequestException('cursor 无效。');
    }
  }

  private validateExecutionItemDependencies(
    items: Array<{ id: string; title: string; dependsOnIds: unknown; required?: boolean }>,
  ) {
    const itemIds = new Set(items.map((item) => item.id));
    const graph = new Map<string, string[]>();
    for (const item of items) {
      const dependencies = Array.isArray(item.dependsOnIds) ? item.dependsOnIds.map(String) : [];
      if (dependencies.includes(item.id) || dependencies.some((dependency) => !itemIds.has(dependency))) {
        throw new BadRequestException(`执行项「${item.title}」的依赖无效。`);
      }
      graph.set(item.id, dependencies);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new BadRequestException('执行项依赖不能形成循环。');
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of graph.get(id) ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    for (const item of items) visit(item.id);
  }

  private async assertProjectVersion(projectId: string, versionId: string, auth?: AuthSession) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, workspaceId: true, currentVersionId: true, workspace: { select: { organizationId: true, repositories: { where: { status: 'ACTIVE' }, select: { id: true } } } } } });
    if (!project) throw new NotFoundException('项目不存在。');
    this.assertOrganization(project.workspace.organizationId, auth);
    const version = await this.prisma.projectVersion.findFirst({ where: { id: versionId, projectId }, select: { id: true } });
    if (!version) throw new NotFoundException('版本不存在或不属于该项目。');
    return project;
  }

  private assertOrganization(organizationId: string, auth?: AuthSession) {
    const requested = auth?.organization?.id;
    if (requested && requested !== organizationId) throw new ForbiddenException('无权访问该组织的数据。');
  }

  private async assertUserInOrganization(userId: string, organizationId: string) {
    const membership = await this.prisma.userOrganization.findFirst({ where: { userId, organizationId }, select: { id: true } });
    if (!membership) throw new BadRequestException('负责人不属于当前组织。');
  }
}
