import { parsePagination, pageResult, type PaginationQuery } from '../common/pagination';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTIVE_EXECUTION_SESSION_STATUSES } from '../execution-sessions/execution-session-state';
import { formatCalendarDate } from '../common/business-days';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { summarizeRequirementSchedule } from './project-schedule-summary';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProjectDto) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: dto.workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found.');
    }

    return this.prisma.project.create({
      data: {
        workspaceId: dto.workspaceId,
        name: dto.name.trim(),
        code: dto.code?.trim() || null,
        description: dto.description?.trim() || null,
      },
      include: {
        workspace: {
          include: {
            repositories: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        currentVersion: { select: { id: true, name: true } },
        versions: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' as const } },
        _count: {
          select: {
            workItems: true,
          },
        },
      },
    });
  }

  async findPage(query: PaginationQuery & { workspaceId?: string; q?: string } = {}) {
    const paging = parsePagination(query);
    const where = { ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}), ...(query.q?.trim() ? { OR: [{ name: { contains: query.q.trim() } }, { code: { contains: query.q.trim() } }] } : {}) };
    const [items, total, scopeTotal, workspaceCount, requirementCount] = await Promise.all([
      this.prisma.project.findMany({ where, skip: paging.skip, take: paging.take, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { workspace: true, currentVersion: { select: { id: true, name: true } }, _count: { select: { workItems: true, versions: true } } } }),
      this.prisma.project.count({ where }),
      this.prisma.project.count({ where: query.workspaceId ? { workspaceId: query.workspaceId } : {} }),
      this.prisma.workspace.count({ where: { projects: { some: where } } }),
      this.prisma.workItem.count({ where: { project: where, kind: 'REQUIREMENT' } }),
    ]);
    return { ...pageResult(items, total, paging), summary: { total: scopeTotal, visible: total, workspaceCount, requirementCount } };
  }

  async findDetail(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id }, include: { workspace: true, currentVersion: { select: { id: true, name: true } }, _count: { select: { workItems: true, versions: true } } } });
    if (!project) throw new NotFoundException('Project not found.');
    return project;
  }

  async remove(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id }, select: { id: true, currentVersionId: true } });
    if (!project) throw new NotFoundException('项目不存在。');

    await this.prisma.$transaction(async (tx) => {
      const workItems = await tx.workItem.findMany({ where: { projectId: id }, select: { id: true } });
      const workItemIds = workItems.map((row) => row.id);
      const workflows = await tx.workflowRun.findMany({ where: { workItemId: { in: workItemIds } }, select: { id: true } });
      const workflowIds = workflows.map((row) => row.id);
      const activeStage = workflowIds.length
        ? await tx.stageExecution.count({ where: { workflowRunId: { in: workflowIds }, status: 'RUNNING' } })
        : 0;
      const activeSession = await tx.executionSession.count({
        where: {
          status: { in: [...ACTIVE_EXECUTION_SESSION_STATUSES] },
          OR: [
            { projectId: id },
            ...(workflowIds.length ? [{ workflowRunId: { in: workflowIds } }] : []),
            { executionItem: { executionPlan: { workItem: { projectId: id } } } },
            { testRun: { testPlan: { testRequest: { projectId: id } } } },
          ],
        },
      });
      if (activeStage || activeSession) {
        throw new ConflictException('项目存在执行中的工作流或本地任务，请先完成或取消后再删除。');
      }

      const stageExecutions = workflowIds.length
        ? await tx.stageExecution.findMany({ where: { workflowRunId: { in: workflowIds } }, select: { id: true } })
        : [];
      const stageIds = stageExecutions.map((row) => row.id);
      const testRequests = await tx.testRequest.findMany({ where: { projectId: id }, select: { id: true } });
      const testRequestIds = testRequests.map((row) => row.id);
      const testDesigns = await tx.testDesign.findMany({ where: { projectId: id }, select: { id: true } });
      const testDesignIds = testDesigns.map((row) => row.id);

      if (testRequestIds.length) {
        await tx.testRequestWorkItem.deleteMany({ where: { testRequestId: { in: testRequestIds } } });
        await tx.testRequestWorkflowRun.deleteMany({ where: { testRequestId: { in: testRequestIds } } });
        await tx.testRequestArtifact.deleteMany({ where: { testRequestId: { in: testRequestIds } } });
      }
      if (testDesignIds.length) {
        await tx.testDesignWorkItem.deleteMany({ where: { testDesignId: { in: testDesignIds } } });
        await tx.testDesignWorkflowRun.deleteMany({ where: { testDesignId: { in: testDesignIds } } });
      }
      await tx.testRequest.deleteMany({ where: { id: { in: testRequestIds } } });
      await tx.testDesign.deleteMany({ where: { id: { in: testDesignIds } } });

      if (workflowIds.length) {
        await tx.bug.updateMany({ where: { OR: [{ workflowRunId: { in: workflowIds } }, { fixWorkflowRunId: { in: workflowIds } }] }, data: { workflowRunId: null, fixWorkflowRunId: null } });
        await tx.workItem.updateMany({ where: { sourceWorkflowRunId: { in: workflowIds } }, data: { sourceWorkflowRunId: null } });
        await tx.reviewFinding.deleteMany({ where: { OR: [{ workflowRunId: { in: workflowIds } }, ...(stageIds.length ? [{ sourceStageExecutionId: { in: stageIds } }] : [])] } });
        await tx.codeBranchSubmission.deleteMany({ where: { workflowRunId: { in: workflowIds } } });
        await tx.workflowRepository.deleteMany({ where: { workflowRunId: { in: workflowIds } } });
        await tx.stageExecution.deleteMany({ where: { workflowRunId: { in: workflowIds } } });
        await tx.codeExecution.deleteMany({ where: { workflowRunId: { in: workflowIds } } });
        await tx.reviewReport.deleteMany({ where: { workflowRunId: { in: workflowIds } } });
        await tx.executionSession.deleteMany({ where: { workflowRunId: { in: workflowIds } } });
        await tx.workflowRun.deleteMany({ where: { id: { in: workflowIds } } });
      }
      if (workItemIds.length) {
        await tx.bug.updateMany({ where: { OR: [{ workItemId: { in: workItemIds } }, { fixWorkItemId: { in: workItemIds } }] }, data: { workItemId: null, fixWorkItemId: null } });
        await tx.requirementRepository.deleteMany({ where: { workItemId: { in: workItemIds } } });
        await tx.executionSession.deleteMany({ where: { executionItem: { executionPlan: { workItemId: { in: workItemIds } } } } });
        await tx.workItem.deleteMany({ where: { id: { in: workItemIds } } });
      }

      await tx.project.update({ where: { id }, data: { currentVersionId: null } });
      const dailyReviews = await tx.dailyCodeReview.findMany({ where: { projectId: id }, select: { id: true } });
      const briefings = await tx.briefing.findMany({ where: { projectId: id }, select: { id: true } });
      if (dailyReviews.length || briefings.length) {
        await tx.deliveryLog.deleteMany({ where: { OR: [...(dailyReviews.length ? [{ dailyCodeReviewId: { in: dailyReviews.map((row) => row.id) } }] : []), ...(briefings.length ? [{ briefingId: { in: briefings.map((row) => row.id) } }] : [])] } });
      }
      await tx.dailyCodeReview.deleteMany({ where: { projectId: id } });
      await tx.briefing.deleteMany({ where: { projectId: id } });
      await tx.executionSession.deleteMany({ where: { projectId: id } });
      await tx.bug.updateMany({ where: { projectId: id }, data: { projectId: null } });
      await tx.deliveryLog.deleteMany({ where: { deliveryTarget: { projectId: id } } });
      await tx.project.delete({ where: { id } });
    });

    return { success: true, projectId: id };
  }

  findAll() {
    return this.prisma.project.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        workspace: {
          include: {
            repositories: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        currentVersion: { select: { id: true, name: true } },
        versions: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' as const } },
        _count: {
          select: {
            workItems: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: {
        workspace: {
          include: {
            repositories: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        currentVersion: { select: { id: true, name: true } },
        versions: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' as const } },
        workItems: {
          orderBy: { createdAt: 'desc' },
          include: {
            version: { select: { id: true, name: true } },
            assignments: {
              include: { user: true },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            },
          },
        },
        _count: {
          select: {
            workItems: true,
          },
        },
      },
    });

    return {
      ...project,
        workItems: project.workItems.filter((item) => item.kind === 'REQUIREMENT').map((workItem) => ({
        ...workItem,
        assignments: workItem.assignments.map((assignment) => ({
          id: assignment.id,
          userId: assignment.userId,
          role: assignment.role,
          plannedStartDate: formatCalendarDate(assignment.plannedStartDate),
          plannedEndDate: formatCalendarDate(assignment.plannedEndDate),
          sortOrder: assignment.sortOrder,
          colorToken: assignment.colorToken,
          note: assignment.note,
          user: {
            id: assignment.user.id,
            displayName: assignment.user.displayName,
            avatarUrl: assignment.user.avatarUrl,
          },
        })),
        scheduleSummary: summarizeRequirementSchedule(workItem.assignments),
      })),
    };
  }
}
