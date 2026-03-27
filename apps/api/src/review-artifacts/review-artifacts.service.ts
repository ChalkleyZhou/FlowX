import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConvertToBugDto } from './dto/convert-to-bug.dto';
import { ConvertToIssueDto } from './dto/convert-to-issue.dto';
import { UpdateBugDto } from './dto/update-bug.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { UpdateReviewFindingDto } from './dto/update-review-finding.dto';

type FindingType = 'ISSUE' | 'BUG' | 'MISSING_TEST' | 'SUGGESTION';

@Injectable()
export class ReviewArtifactsService {
  constructor(private readonly prisma: PrismaService) {}

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
            requirement: true,
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

        if (existing && (existing.convertedBugId || existing.convertedIssueId)) {
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
    if (finding.convertedIssueId || finding.convertedBugId) {
      throw new BadRequestException('已转化的条目不能忽略。');
    }
    return this.prisma.reviewFinding.update({
      where: { id },
      data: { status: 'DISMISSED' },
    });
  }

  async convertReviewFindingToIssue(id: string, dto: ConvertToIssueDto, userId: string | null) {
    const finding = await this.getFindingOrThrow(id);
    if (finding.convertedIssueId) {
      throw new BadRequestException('该条目已经转成 Issue。');
    }
    if (finding.convertedBugId) {
      throw new BadRequestException('该条目已经转成 Bug。');
    }

    const workflowRun = await this.prisma.workflowRun.findUnique({
      where: { id: finding.workflowRunId },
      include: { requirement: true },
    });
    if (!workflowRun?.requirement.workspaceId) {
      throw new BadRequestException('当前工作流未绑定工作区，无法创建 Issue。');
    }

    const issue = await this.prisma.issue.create({
      data: {
        status: 'OPEN',
        priority: dto.priority ?? this.mapSeverityToPriority(finding.severity),
        title: dto.title ?? finding.title,
        description: dto.description ?? finding.description,
        workspaceId: workflowRun.requirement.workspaceId,
        requirementId: workflowRun.requirementId,
        workflowRunId: workflowRun.id,
        repositoryId: dto.repositoryId ?? null,
        branchName: dto.branchName ?? this.inferBranchName(workflowRun.id),
        reportedByUserId: userId,
      },
    });

    await this.prisma.reviewFinding.update({
      where: { id },
      data: {
        status: 'CONVERTED_TO_ISSUE',
        convertedIssueId: issue.id,
      },
    });

    return issue;
  }

  async convertReviewFindingToBug(id: string, dto: ConvertToBugDto, userId: string | null) {
    const finding = await this.getFindingOrThrow(id);
    if (finding.convertedBugId) {
      throw new BadRequestException('该条目已经转成 Bug。');
    }
    if (finding.convertedIssueId) {
      throw new BadRequestException('该条目已经转成 Issue。');
    }

    const workflowRun = await this.prisma.workflowRun.findUnique({
      where: { id: finding.workflowRunId },
      include: { requirement: true },
    });
    if (!workflowRun?.requirement.workspaceId) {
      throw new BadRequestException('当前工作流未绑定工作区，无法创建 Bug。');
    }

    const bug = await this.prisma.bug.create({
      data: {
        status: 'OPEN',
        severity: dto.severity ?? finding.severity,
        priority: dto.priority ?? this.mapSeverityToPriority(dto.severity ?? finding.severity),
        title: dto.title ?? finding.title,
        description: dto.description ?? finding.description,
        expectedBehavior: dto.expectedBehavior,
        actualBehavior: dto.actualBehavior,
        reproductionSteps: dto.reproductionSteps ?? [],
        workspaceId: workflowRun.requirement.workspaceId,
        requirementId: workflowRun.requirementId,
        workflowRunId: workflowRun.id,
        repositoryId: dto.repositoryId ?? null,
        branchName: dto.branchName ?? this.inferBranchName(workflowRun.id),
        reportedByUserId: userId,
      },
    });

    await this.prisma.reviewFinding.update({
      where: { id },
      data: {
        status: 'CONVERTED_TO_BUG',
        convertedBugId: bug.id,
      },
    });

    return bug;
  }

  async getIssues(filters: { workspaceId?: string; workflowRunId?: string; status?: string }) {
    return this.prisma.issue.findMany({
      where: {
        ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
        ...(filters.workflowRunId ? { workflowRunId: filters.workflowRunId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: {
        workspace: true,
        requirement: true,
        workflowRun: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getIssue(id: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id },
      include: {
        workspace: true,
        requirement: true,
        workflowRun: true,
        reviewFinding: true,
      },
    });
    if (!issue) {
      throw new NotFoundException('Issue not found.');
    }
    return issue;
  }

  async updateIssue(id: string, dto: UpdateIssueDto) {
    await this.getIssue(id);
    return this.prisma.issue.update({
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
        requirement: true,
        workflowRun: true,
        reviewFinding: true,
      },
    });
  }

  async getBugs(filters: { workspaceId?: string; workflowRunId?: string; status?: string }) {
    return this.prisma.bug.findMany({
      where: {
        ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
        ...(filters.workflowRunId ? { workflowRunId: filters.workflowRunId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: {
        workspace: true,
        requirement: true,
        workflowRun: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBug(id: string) {
    const bug = await this.prisma.bug.findUnique({
      where: { id },
      include: {
        workspace: true,
        requirement: true,
        workflowRun: true,
        reviewFinding: true,
      },
    });
    if (!bug) {
      throw new NotFoundException('Bug not found.');
    }
    return bug;
  }

  async updateBug(id: string, dto: UpdateBugDto) {
    await this.getBug(id);
    return this.prisma.bug.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.severity !== undefined ? { severity: dto.severity } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.expectedBehavior !== undefined ? { expectedBehavior: dto.expectedBehavior } : {}),
        ...(dto.actualBehavior !== undefined ? { actualBehavior: dto.actualBehavior } : {}),
        ...(dto.reproductionSteps !== undefined ? { reproductionSteps: dto.reproductionSteps } : {}),
        ...(dto.resolution !== undefined ? { resolution: dto.resolution } : {}),
        ...(dto.branchName !== undefined ? { branchName: dto.branchName } : {}),
      },
      include: {
        workspace: true,
        requirement: true,
        workflowRun: true,
        reviewFinding: true,
      },
    });
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
    return items.map((item, index) => ({
      workflowRunId,
      reviewReportId,
      type,
      sourceType: type,
      sourceIndex: index,
      severity: this.defaultSeverityForType(type),
      title: item,
      description: item,
      recommendation: null,
      impactScope,
      metadata: { sourceValue: item },
      status: 'OPEN',
    }));
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
}
