import { parsePagination, pageResult, type PaginationQuery } from '../common/pagination';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import {
  parseBugScreenshots,
  persistBugScreenshots,
  readBugScreenshotFile,
} from './bug-screenshot.storage';
import { ConvertToBugDto } from './dto/convert-to-bug.dto';
import { CreateBugDto } from './dto/create-bug.dto';
import { ConvertToIssueDto } from './dto/convert-to-issue.dto';
import { StartBugFixWorkflowDto } from './dto/start-bug-fix-workflow.dto';
import { UpdateBugDto } from './dto/update-bug.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { UpdateReviewFindingDto } from './dto/update-review-finding.dto';

type FindingType = 'ISSUE' | 'BUG' | 'MISSING_TEST' | 'SUGGESTION';

@Injectable()
export class ReviewArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowService: WorkflowService,
  ) {}

  async getWorkflowRunReviewFindingsPage(workflowRunId: string, query: PaginationQuery = {}) {
    const paging = parsePagination(query);
    await this.prisma.workflowRun.findUniqueOrThrow({ where: { id: workflowRunId }, select: { id: true } });
    const where = { workflowRunId };
    const [items, total, pendingCount] = await Promise.all([this.prisma.reviewFinding.findMany({ where, skip: paging.skip, take: paging.take, orderBy: [{ createdAt: 'asc' }, { sourceIndex: 'asc' }, { id: 'asc' }] }), this.prisma.reviewFinding.count({ where }), this.prisma.reviewFinding.count({ where: { ...where, convertedWorkItemId: null, convertedBugId: null } })]);
    return { ...pageResult(items, total, paging), summary: { pendingCount } };
  }

  async getWorkflowRunReviewFindings(workflowRunId: string) {
    await this.prisma.workflowRun.findUniqueOrThrow({ where: { id: workflowRunId } });
    return this.prisma.reviewFinding.findMany({
      where: { workflowRunId },
      orderBy: [{ createdAt: 'asc' }, { sourceIndex: 'asc' }],
    });
  }

  async syncReviewFindings(reviewReportId: string) {
    const reviewReport = await this.prisma.reviewReport.findUnique({
      where: { id: reviewReportId },
      include: {
        workflowRun: {
          include: {
            stageExecutions: {
              where: { stage: 'AI_REVIEW' },
              orderBy: { attempt: 'desc' },
            },
            workItem: true,
          },
        },
        reviewFindings: true,
      },
    });

    if (!reviewReport) {
      throw new NotFoundException('Review report not found.');
    }

    const latestReviewStage = reviewReport.workflowRun.stageExecutions[0] ?? null;
    const impactScope = this.toStringArray(reviewReport.impactScope);
    const serializedFindings = [
      ...this.serializeFindingGroup(reviewReport.workflowRunId, reviewReportId, 'ISSUE', this.toStringArray(reviewReport.issues), impactScope),
      ...this.serializeFindingGroup(reviewReport.workflowRunId, reviewReportId, 'BUG', this.toStringArray(reviewReport.bugs), impactScope),
      ...this.serializeFindingGroup(reviewReport.workflowRunId, reviewReportId, 'MISSING_TEST', this.toStringArray(reviewReport.missingTests), impactScope),
      ...this.serializeFindingGroup(reviewReport.workflowRunId, reviewReportId, 'SUGGESTION', this.toStringArray(reviewReport.suggestions), impactScope),
    ];

    await this.prisma.$transaction(async (tx) => {
      for (const finding of serializedFindings) {
        const existing = await tx.reviewFinding.findUnique({
          where: {
            reviewReportId_sourceType_sourceIndex: {
              reviewReportId,
              sourceType: finding.sourceType,
              sourceIndex: finding.sourceIndex,
            },
          },
        });

        if (existing && (existing.convertedBugId || existing.convertedWorkItemId)) {
          await tx.reviewFinding.update({
            where: { id: existing.id },
            data: {
              title: finding.title,
              description: finding.description,
              recommendation: finding.recommendation,
              impactScope: finding.impactScope,
              metadata: finding.metadata,
              severity: finding.severity,
              sourceStageExecutionId: latestReviewStage?.id ?? null,
            },
          });
          continue;
        }

        await tx.reviewFinding.upsert({
          where: {
            reviewReportId_sourceType_sourceIndex: {
              reviewReportId,
              sourceType: finding.sourceType,
              sourceIndex: finding.sourceIndex,
            },
          },
          create: {
            ...finding,
            sourceStageExecutionId: latestReviewStage?.id ?? null,
          },
          update: {
            status: 'OPEN',
            type: finding.type,
            severity: finding.severity,
            title: finding.title,
            description: finding.description,
            recommendation: finding.recommendation,
            impactScope: finding.impactScope,
            metadata: finding.metadata,
            sourceStageExecutionId: latestReviewStage?.id ?? null,
          },
        });
      }
    });

    return this.getWorkflowRunReviewFindings(reviewReport.workflowRunId);
  }

  async updateReviewFinding(id: string, dto: UpdateReviewFindingDto) {
    await this.getFindingOrThrow(id);
    return this.prisma.reviewFinding.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.recommendation !== undefined ? { recommendation: dto.recommendation } : {}),
        ...(dto.severity !== undefined ? { severity: dto.severity } : {}),
      },
    });
  }

  async acceptReviewFinding(id: string) {
    const finding = await this.getFindingOrThrow(id);
    if (finding.status === 'DISMISSED') {
      throw new BadRequestException('已忽略的条目不能直接接受，请先人工修改。');
    }
    return this.prisma.reviewFinding.update({
      where: { id },
      data: { status: 'ACCEPTED' },
    });
  }

  async dismissReviewFinding(id: string) {
    const finding = await this.getFindingOrThrow(id);
    if (finding.convertedWorkItemId || finding.convertedBugId) {
      throw new BadRequestException('已转化的条目不能忽略。');
    }
    return this.prisma.reviewFinding.update({
      where: { id },
      data: { status: 'DISMISSED' },
    });
  }

  async convertReviewFindingToIssue(id: string, dto: ConvertToIssueDto, userId: string | null) {
    const finding = await this.getFindingOrThrow(id);
    if (finding.convertedWorkItemId) {
      throw new BadRequestException('该条目已经转成 Issue。');
    }
    if (finding.convertedBugId) {
      throw new BadRequestException('该条目已经转成 Bug。');
    }

    const workflowRun = await this.prisma.workflowRun.findUnique({
      where: { id: finding.workflowRunId },
      include: { workItem: true },
    });
    if (!workflowRun?.workItem.workspaceId) {
      throw new BadRequestException('当前工作流未绑定工作区，无法创建 Issue。');
    }

    const issue = await this.prisma.workItem.create({
      data: {
        status: 'OPEN',
        priority: dto.priority ?? this.mapSeverityToPriority(finding.severity),
        title: dto.title ?? this.getFindingDefaultTitle(finding),
        description: dto.description ?? this.getFindingDefaultDescription(finding),
        kind: 'ISSUE',
        workspaceId: workflowRun.workItem.workspaceId,
        projectId: workflowRun.workItem.projectId,
        versionId: workflowRun.workItem.versionId,
        sourceWorkflowRunId: workflowRun.id,
        repositoryId: dto.repositoryId ?? null,
        branchName: dto.branchName ?? this.inferBranchName(workflowRun.id),
        reportedByUserId: userId,
        executionPlans: {
          create: {
            status: 'CONFIRMED',
            strategy: 'SINGLE',
            ...(userId ? { createdByUserId: userId } : {}),
            items: {
              create: {
                title: dto.title ?? this.getFindingDefaultTitle(finding),
                description: dto.description ?? this.getFindingDefaultDescription(finding),
                target: 'LOCAL',
                status: 'READY',
              },
            },
          },
        },
      },
    });

    await this.prisma.reviewFinding.update({
      where: { id },
      data: {
        status: 'CONVERTED_TO_ISSUE',
        convertedWorkItemId: issue.id,
      },
    });

    return issue;
  }

  async convertReviewFindingToBug(id: string, dto: ConvertToBugDto, userId: string | null) {
    const finding = await this.getFindingOrThrow(id);
    if (finding.convertedBugId) {
      throw new BadRequestException('该条目已经转成 Bug。');
    }
    if (finding.convertedWorkItemId) {
      throw new BadRequestException('该条目已经转成 Issue。');
    }

    const workflowRun = await this.prisma.workflowRun.findUnique({
      where: { id: finding.workflowRunId },
      include: { workItem: true },
    });
    if (!workflowRun?.workItem.workspaceId) {
      throw new BadRequestException('当前工作流未绑定工作区，无法创建 Bug。');
    }

    const useWorkItem = Boolean(this.prisma.workItem?.create);
    const bug = useWorkItem
      ? await this.prisma.workItem.create({
          data: {
            status: 'OPEN', kind: 'BUG', severity: dto.severity ?? finding.severity,
            priority: dto.priority ?? this.mapSeverityToPriority(dto.severity ?? finding.severity),
            title: dto.title ?? this.getFindingDefaultTitle(finding), description: dto.description ?? this.getFindingDefaultDescription(finding),
            expectedBehavior: dto.expectedBehavior, actualBehavior: dto.actualBehavior, reproductionSteps: dto.reproductionSteps ?? [],
            workspaceId: workflowRun.workItem.workspaceId, projectId: workflowRun.workItem.projectId, sourceWorkflowRunId: workflowRun.id,
            repositoryId: dto.repositoryId ?? null, branchName: dto.branchName ?? this.inferBranchName(workflowRun.id), reportedByUserId: userId,
            executionPlans: { create: { status: 'CONFIRMED', strategy: 'SINGLE', ...(userId ? { createdByUserId: userId } : {}), items: { create: { title: dto.title ?? this.getFindingDefaultTitle(finding), description: dto.description ?? this.getFindingDefaultDescription(finding), target: 'LOCAL', status: 'READY' } } } },
          },
        })
      : await this.prisma.bug.create({
          data: {
            status: 'OPEN', severity: dto.severity ?? finding.severity,
            priority: dto.priority ?? this.mapSeverityToPriority(dto.severity ?? finding.severity),
            title: dto.title ?? this.getFindingDefaultTitle(finding), description: dto.description ?? this.getFindingDefaultDescription(finding),
            expectedBehavior: dto.expectedBehavior, actualBehavior: dto.actualBehavior, reproductionSteps: dto.reproductionSteps ?? [],
            workspaceId: workflowRun.workItem.workspaceId, projectId: workflowRun.workItem.projectId, workItemId: workflowRun.workItemId,
            workflowRunId: workflowRun.id, repositoryId: dto.repositoryId ?? null, branchName: dto.branchName ?? this.inferBranchName(workflowRun.id), reportedByUserId: userId,
          },
        });

    await this.prisma.reviewFinding.update({
      where: { id },
      data: {
        status: 'CONVERTED_TO_BUG',
        ...(useWorkItem ? { convertedWorkItemId: bug.id } : { convertedBugId: bug.id }),
      },
    });

    return bug;
  }

  async getIssuesPage(query: PaginationQuery & { workspaceId?: string; projectId?: string; workflowRunId?: string; status?: string; priority?: string; severity?: string; q?: string } = {}) {
    const paging = parsePagination(query);
    const scope = {};
    const where = { kind: 'ISSUE', ...scope, ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}), ...(query.workflowRunId ? { sourceWorkflowRunId: query.workflowRunId } : {}), ...(query.status ? { status: query.status } : {}), ...(query.priority ? { priority: query.priority } : {}), ...(query.projectId ? { projectId: query.projectId } : {}), ...(query.q?.trim() ? { OR: [{ title: { contains: query.q.trim() } }, { description: { contains: query.q.trim() } }, { workspace: { name: { contains: query.q.trim() } } }] } : {}) };
    const [items, total, scopeTotal, openCount] = await Promise.all([
      this.prisma.workItem.findMany({ where, skip: paging.skip, take: paging.take, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { workspace: true, sourceWorkflowRun: true } }),
      this.prisma.workItem.count({ where }), this.prisma.workItem.count({ where: scope }), this.prisma.workItem.count({ where: { ...scope, status: 'OPEN' } }),
    ]);
    return { ...pageResult(items, total, paging), summary: { total: scopeTotal, visible: total, openCount, inProgressCount: await this.prisma.workItem.count({ where: { ...scope, status: 'IN_PROGRESS' } }) } };
  }

  async getIssues(filters: { workspaceId?: string; workflowRunId?: string; status?: string }) {
    return this.prisma.workItem.findMany({
      where: {
        ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
        ...(filters.workflowRunId ? { sourceWorkflowRunId: filters.workflowRunId } : {}),
        kind: 'ISSUE',
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: {
        workspace: true,
        sourceWorkflowRun: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getIssue(id: string) {
    const issue = await this.prisma.workItem.findUnique({
      where: { id },
      include: {
        workspace: true,
        sourceWorkflowRun: true,
        reviewFinding: true,
        executionPlans: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } },
      },
    });
    if (!issue) {
      throw new NotFoundException('Issue not found.');
    }
    return issue;
  }

  async updateIssue(id: string, dto: UpdateIssueDto) {
    await this.getIssue(id);
    return this.prisma.workItem.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.resolution !== undefined ? { resolution: dto.resolution } : {}),
        ...(dto.branchName !== undefined ? { branchName: dto.branchName } : {}),
      },
      include: {
        workspace: true,
        sourceWorkflowRun: true,
        reviewFinding: true,
      },
    });
  }

  async createBug(dto: CreateBugDto, userId: string | null) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: dto.workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found.');

    let projectId = dto.projectId;
    if (projectId) {
      const project = await this.prisma.project.findFirst({ where: { id: projectId, workspaceId: dto.workspaceId, status: 'ACTIVE' } });
      if (!project) throw new BadRequestException('Project does not belong to the selected workspace.');
    } else {
      const project = await this.prisma.project.findFirst({ where: { workspaceId: dto.workspaceId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
      if (project) projectId = project.id;
      else {
        const created = await this.prisma.project.create({ data: { workspaceId: dto.workspaceId, name: '缺陷池', description: '缺陷工作项默认项目' } });
        projectId = created.id;
      }
    }

    if (dto.repositoryId) {
      const repository = await this.prisma.repository.findFirst({ where: { id: dto.repositoryId, workspaceId: dto.workspaceId, status: 'ACTIVE' } });
      if (!repository) throw new BadRequestException('Repository does not belong to the selected workspace.');
    }

    const bug = await this.prisma.workItem.create({
      data: {
        kind: 'BUG', status: 'OPEN', severity: dto.severity ?? 'MEDIUM', priority: dto.priority ?? 'MEDIUM',
        title: dto.title.trim(), description: dto.description.trim(), expectedBehavior: dto.expectedBehavior?.trim() || null,
        actualBehavior: dto.actualBehavior?.trim() || null, reproductionSteps: dto.reproductionSteps ?? [], screenshots: [],
        workspaceId: dto.workspaceId, projectId, repositoryId: dto.repositoryId ?? null, branchName: dto.branchName?.trim() || null,
        reportedByUserId: userId,
        executionPlans: { create: { status: 'CONFIRMED', strategy: 'SINGLE', ...(userId ? { createdByUserId: userId } : {}), items: { create: { title: dto.title.trim(), description: dto.description.trim(), target: 'LOCAL', status: 'READY' } } } },
      },
      include: { workspace: true, project: true, sourceWorkflowRun: true, fixWorkflowRun: true, fixWorkItem: true, reviewFinding: true },
    });

    if (!dto.screenshots?.length) return { ...bug, workflowRun: bug.sourceWorkflowRun, workflowRunId: bug.sourceWorkflowRunId, workItemId: bug.id };
    try {
      const screenshots = await persistBugScreenshots(bug.id, dto.screenshots);
      const updated = await this.prisma.workItem.update({
        where: { id: bug.id },
        data: { screenshots: screenshots as unknown as Prisma.InputJsonValue },
        include: { workspace: true, project: true, sourceWorkflowRun: true, fixWorkflowRun: true, fixWorkItem: true, reviewFinding: true },
      });
      return { ...updated, workflowRun: updated.sourceWorkflowRun, workflowRunId: updated.sourceWorkflowRunId, workItemId: updated.id };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '截图保存失败');
    }
  }

  async getBugScreenshotFile(bugId: string, screenshotId: string) {
    const bug = await this.getBug(bugId);
    const screenshots = parseBugScreenshots(bug.screenshots);
    try { return await readBugScreenshotFile(bugId, screenshotId, screenshots); }
    catch { throw new NotFoundException('Screenshot not found.'); }
  }

  async startBugFixWorkflow(bugId: string, dto: StartBugFixWorkflowDto) {
    return this.workflowService.createBugFixWorkflowRun(bugId, dto);
  }

  async getBugsPage(query: PaginationQuery & { workspaceId?: string; projectId?: string; versionId?: string; workflowRunId?: string; status?: string; priority?: string; severity?: string; q?: string } = {}) {
    const paging = parsePagination(query);
    const where: Prisma.WorkItemWhereInput = {
      kind: 'BUG', ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}), ...(query.projectId ? { projectId: query.projectId } : {}), ...(query.versionId ? { versionId: query.versionId } : {}),
      ...(query.workflowRunId ? { sourceWorkflowRunId: query.workflowRunId } : {}), ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}), ...(query.severity ? { severity: query.severity } : {}),
      ...(query.q?.trim() ? { OR: [{ title: { contains: query.q.trim() } }, { description: { contains: query.q.trim() } }, { workspace: { name: { contains: query.q.trim() } } }] } : {}),
    };
    const [items, total, openCount, criticalCount] = await Promise.all([
      this.prisma.workItem.findMany({ where, skip: paging.skip, take: paging.take, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { workspace: true, project: true, sourceWorkflowRun: true, fixWorkflowRun: true, fixWorkItem: true, reviewFinding: true } }),
      this.prisma.workItem.count({ where }), this.prisma.workItem.count({ where: { ...where, status: 'OPEN' } }), this.prisma.workItem.count({ where: { ...where, severity: 'CRITICAL' } }),
    ]);
    return { ...pageResult(items.map(item => ({ ...item, workflowRun: item.sourceWorkflowRun, workflowRunId: item.sourceWorkflowRunId, workItemId: item.id })), total, paging), summary: { total, visible: total, openCount, criticalCount } };
  }

  async getBugs(filters: { workspaceId?: string; workflowRunId?: string; status?: string }) {
    const items = await this.prisma.workItem.findMany({
      where: { kind: 'BUG', ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}), ...(filters.workflowRunId ? { sourceWorkflowRunId: filters.workflowRunId } : {}), ...(filters.status ? { status: filters.status } : {}) },
      include: { workspace: true, project: true, sourceWorkflowRun: true, fixWorkflowRun: true, fixWorkItem: true, reviewFinding: true }, orderBy: { createdAt: 'desc' },
    });
    return items.map(item => ({ ...item, workflowRun: item.sourceWorkflowRun, workflowRunId: item.sourceWorkflowRunId, workItemId: item.id }));
  }

  async getBug(id: string) {
    const bug = await this.prisma.workItem.findFirst({ where: { id, kind: 'BUG' }, include: { workspace: true, project: true, sourceWorkflowRun: true, fixWorkflowRun: true, fixWorkItem: true, reviewFinding: true, executionPlans: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } } } });
    if (!bug) throw new NotFoundException('Bug not found.');
    return { ...bug, workflowRun: bug.sourceWorkflowRun, workflowRunId: bug.sourceWorkflowRunId, workItemId: bug.id };
  }

  async updateBug(id: string, dto: UpdateBugDto) {
    const bug = await this.getBug(id);
    const existingScreenshots = parseBugScreenshots(bug.screenshots);
    let nextScreenshots: Prisma.InputJsonValue | undefined;
    if (dto.screenshots?.length) {
      try { nextScreenshots = [...existingScreenshots, ...await persistBugScreenshots(id, dto.screenshots, existingScreenshots)] as unknown as Prisma.InputJsonValue; }
      catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '截图保存失败'); }
    }
    const updated = await this.prisma.workItem.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}), ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}), ...(dto.severity !== undefined ? { severity: dto.severity } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}), ...(dto.expectedBehavior !== undefined ? { expectedBehavior: dto.expectedBehavior } : {}),
        ...(dto.actualBehavior !== undefined ? { actualBehavior: dto.actualBehavior } : {}), ...(dto.reproductionSteps !== undefined ? { reproductionSteps: dto.reproductionSteps } : {}),
        ...(dto.resolution !== undefined ? { resolution: dto.resolution } : {}), ...(dto.branchName !== undefined ? { branchName: dto.branchName } : {}),
        ...(nextScreenshots !== undefined ? { screenshots: nextScreenshots } : {}),
      },
      include: { workspace: true, project: true, sourceWorkflowRun: true, fixWorkflowRun: true, fixWorkItem: true, reviewFinding: true },
    });
    return { ...updated, workflowRun: updated.sourceWorkflowRun, workflowRunId: updated.sourceWorkflowRunId, workItemId: updated.id };
  }

  private async getFindingOrThrow(id: string) {
    const finding = await this.prisma.reviewFinding.findUnique({ where: { id } });
    if (!finding) {
      throw new NotFoundException('Review finding not found.');
    }
    return finding;
  }

  private serializeFindingGroup(
    workflowRunId: string,
    reviewReportId: string,
    type: FindingType,
    items: string[],
    impactScope: string[],
  ) {
    return items.map((item, index) => {
      const normalized = this.normalizeFindingText(item);

      return {
        workflowRunId,
        reviewReportId,
        type,
        sourceType: type,
        sourceIndex: index,
        severity: this.defaultSeverityForType(type),
        title: normalized.title,
        description: normalized.description,
        recommendation: null,
        impactScope,
        metadata: { sourceValue: item },
        status: 'OPEN',
      };
    });
  }

  private toStringArray(value: Prisma.JsonValue): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
  }

  private defaultSeverityForType(type: FindingType) {
    switch (type) {
      case 'BUG':
        return 'HIGH';
      case 'ISSUE':
      case 'MISSING_TEST':
        return 'MEDIUM';
      case 'SUGGESTION':
      default:
        return 'LOW';
    }
  }

  private mapSeverityToPriority(severity?: string) {
    switch (severity) {
      case 'CRITICAL':
        return 'URGENT';
      case 'HIGH':
        return 'HIGH';
      case 'LOW':
        return 'LOW';
      case 'MEDIUM':
      default:
        return 'MEDIUM';
    }
  }

  private inferBranchName(workflowRunId: string) {
    return workflowRunId ? `workflow/${workflowRunId}` : null;
  }

  private getFindingDefaultTitle(finding: {
    title: string;
    description: string;
    metadata: Prisma.JsonValue;
  }) {
    if (finding.title && finding.title !== finding.description) {
      return finding.title;
    }

    const sourceValue =
      finding.metadata && typeof finding.metadata === 'object' && !Array.isArray(finding.metadata)
        ? (finding.metadata as Record<string, unknown>).sourceValue
        : null;

    if (typeof sourceValue === 'string' && sourceValue.trim()) {
      return this.normalizeFindingText(sourceValue).title;
    }

    return this.extractFindingTitle(finding.title || finding.description);
  }

  private getFindingDefaultDescription(finding: {
    title: string;
    description: string;
    metadata: Prisma.JsonValue;
  }) {
    if (finding.description && finding.description.trim()) {
      return finding.description;
    }

    const sourceValue =
      finding.metadata && typeof finding.metadata === 'object' && !Array.isArray(finding.metadata)
        ? (finding.metadata as Record<string, unknown>).sourceValue
        : null;

    if (typeof sourceValue === 'string') {
      return sourceValue;
    }

    return finding.title;
  }

  private normalizeFindingText(value: string) {
    const source = value.trim().replace(/\s+/g, ' ');
    if (!source) {
      return {
        title: '未命名条目',
        description: '',
      };
    }

    const title = this.extractFindingTitle(source);
    const description = title === source ? source : source;

    return {
      title,
      description,
    };
  }

  private extractFindingTitle(source: string) {
    const delimiters = ['。', '；', ';', '\n'];
    for (const delimiter of delimiters) {
      const index = source.indexOf(delimiter);
      if (index > 0) {
        return this.truncateFindingTitle(source.slice(0, index).trim());
      }
    }

    const colonMatch = source.match(/^([^:：]{1,80})[:：]\s*(.+)$/);
    if (colonMatch?.[1]) {
      return this.truncateFindingTitle(colonMatch[1].trim());
    }

    return this.truncateFindingTitle(source);
  }

  private truncateFindingTitle(value: string) {
    const trimmed = value.trim();
    if (trimmed.length <= 80) {
      return trimmed;
    }

    return `${trimmed.slice(0, 77).trimEnd()}...`;
  }
}
