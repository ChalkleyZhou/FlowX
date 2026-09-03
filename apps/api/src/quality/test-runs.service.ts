import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateTestRunDto, ReportTestResultDto } from './dto/test-run.dto';
import { TestRequestStatus, assertTestRequestTransition } from './quality-status';

@Injectable()
export class TestRunsService {
  constructor(private readonly prisma: PrismaService) {}

  async createRun(testRequestId: string, dto: CreateTestRunDto, userId?: string) {
    const request = await this.prisma.testRequest.findUnique({
      where: { id: testRequestId },
      include: { testPlan: true, workspace: { select: { organizationId: true } } },
    });
    if (!request?.testPlan) {
      throw new NotFoundException('Ready test plan not found.');
    }
    assertTestRequestTransition(request.status as TestRequestStatus, TestRequestStatus.IN_TEST);
    if (request.testPlan.status !== 'READY') {
      throw new BadRequestException('Test plan scope is not ready.');
    }

    const cases = dedupeRunCases(dto.cases);
    const snapshots = await this.prisma.testCaseSnapshot.findMany({
      where: { id: { in: cases.map((item) => item.snapshotId) }, testPlanId: request.testPlan.id },
      select: { id: true },
    });
    if (snapshots.length !== cases.length) {
      throw new BadRequestException('Some snapshots do not belong to the selected test plan.');
    }

    const assigneeIds = unique(
      cases.map((item) => item.assignedToUserId).filter((id): id is string => Boolean(id)),
    );
    if (assigneeIds.length) {
      const memberships = await this.prisma.userOrganization.findMany({
        where: {
          organizationId: request.workspace.organizationId,
          userId: { in: assigneeIds },
        },
        select: { userId: true },
      });
      if (memberships.length !== assigneeIds.length) {
        throw new BadRequestException('Some test assignees are outside the current organization.');
      }
    }

    const runType = dto.runType ?? (dto.sourceBugId ? 'REGRESSION' : 'INITIAL');
    if (runType === 'REGRESSION' && !dto.sourceBugId) {
      throw new BadRequestException('Regression runs require sourceBugId.');
    }
    if (runType === 'INITIAL' && dto.sourceBugId) {
      throw new BadRequestException('Initial runs cannot reference a source bug.');
    }
    if (dto.sourceBugId) {
      const bug = await this.prisma.bug.findFirst({
        where: { id: dto.sourceBugId, projectId: request.projectId },
        include: { fixWorkflowRun: { select: { status: true } } },
      });
      if (!bug?.fixWorkflowRun || bug.fixWorkflowRun.status.toLowerCase() !== 'done') {
        throw new BadRequestException('Bug fix workflow must be completed before regression testing.');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.testRun.create({
        data: {
          testPlanId: request.testPlan!.id,
          name: dto.name.trim(),
          runType,
          sourceBugId: dto.sourceBugId ?? null,
          createdByUserId: userId ?? null,
          startedAt: new Date(),
          cases: {
            create: cases.map((item, index) => ({
              snapshotId: item.snapshotId,
              assignedToUserId: item.assignedToUserId ?? null,
              sortOrder: index,
            })),
          },
        },
        include: { cases: { include: { snapshot: true, assignedToUser: true } } },
      });
      await tx.testRequest.update({
        where: { id: testRequestId },
        data: { status: TestRequestStatus.IN_TEST },
      });
      return run;
    });
  }

  async listRuns(testRequestId: string) {
    const request = await this.prisma.testRequest.findUnique({
      where: { id: testRequestId },
      select: { testPlan: { select: { id: true } } },
    });
    if (!request?.testPlan) {
      return [];
    }
    return this.prisma.testRun.findMany({
      where: { testPlanId: request.testPlan.id },
      include: {
        sourceBug: true,
        cases: { include: { snapshot: true, assignedToUser: true, result: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reportResult(testRunCaseId: string, dto: ReportTestResultDto, userId?: string) {
    const runCase = await this.prisma.testRunCase.findUnique({
      where: { id: testRunCaseId },
      include: {
        testRun: {
          include: { testPlan: { include: { testRequest: { select: { id: true, projectId: true } } } } },
        },
      },
    });
    if (!runCase) {
      throw new NotFoundException('Test run case not found.');
    }
    if (runCase.testRun.status !== 'ACTIVE') {
      throw new BadRequestException('Only active test runs accept results.');
    }
    if (runCase.assignedToUserId && runCase.assignedToUserId !== userId) {
      throw new ForbiddenException('This test case is assigned to another user.');
    }
    if (dto.bugId) {
      const bug = await this.prisma.bug.findFirst({
        where: { id: dto.bugId, projectId: runCase.testRun.testPlan.testRequest.projectId },
      });
      if (!bug) {
        throw new BadRequestException('Bug does not belong to the test request project.');
      }
    }

    const result = await this.prisma.testResult.upsert({
      where: { testRunCaseId },
      update: {
        result: dto.result,
        actualResult: dto.actualResult?.trim() || null,
        remark: dto.remark?.trim() || null,
        evidence: dto.evidence as Prisma.InputJsonValue | undefined,
        bugId: dto.bugId ?? null,
        executedByUserId: userId ?? null,
        executedAt: new Date(),
      },
      create: {
        testRunCaseId,
        result: dto.result,
        actualResult: dto.actualResult?.trim() || null,
        remark: dto.remark?.trim() || null,
        evidence: dto.evidence as Prisma.InputJsonValue | undefined,
        bugId: dto.bugId ?? null,
        executedByUserId: userId ?? null,
      },
    });

    const runCases = await this.prisma.testRunCase.findMany({
      where: { testRunId: runCase.testRun.id },
      include: { result: true },
    });
    if (runCases.length && runCases.every((item) => item.result)) {
      const finalStatus = aggregateResult(runCases.map((item) => item.result!.result));
      await this.prisma.testRun.update({
        where: { id: runCase.testRun.id },
        data: { status: finalStatus, completedAt: new Date() },
      });
      await this.prisma.testRequest.update({
        where: { id: runCase.testRun.testPlan.testRequest.id },
        data: { status: finalStatus },
      });
      return { result, runStatus: finalStatus, testRequestStatus: finalStatus };
    }
    return { result, runStatus: 'ACTIVE', testRequestStatus: TestRequestStatus.IN_TEST };
  }
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function dedupeRunCases<T extends { snapshotId: string }>(cases: T[]): T[] {
  const bySnapshot = new Map<string, T>();
  for (const item of cases) {
    bySnapshot.set(item.snapshotId, item);
  }
  return [...bySnapshot.values()];
}

function aggregateResult(results: string[]): 'PASSED' | 'FAILED' | 'BLOCKED' {
  if (results.includes('FAILED')) {
    return 'FAILED';
  }
  if (results.includes('BLOCKED') || results.includes('SKIPPED')) {
    return 'BLOCKED';
  }
  return 'PASSED';
}
