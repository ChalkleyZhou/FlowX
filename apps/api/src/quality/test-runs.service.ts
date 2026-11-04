import { ConflictException, BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateTestRunDto, ReportTestResultDto } from './dto/test-run.dto';
import { refreshTestRequestStatus } from './test-request-state';
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
    if (request.status !== TestRequestStatus.IN_TEST) assertTestRequestTransition(request.status as TestRequestStatus, TestRequestStatus.IN_TEST);
    if (request.testPlan.status !== 'READY') {
      throw new BadRequestException('Test plan scope is not ready.');
    }

    const cases = dedupeRunCases(dto.cases);
    const runType = dto.runType ?? (dto.sourceBugId ? 'REGRESSION' : 'INITIAL');
    const snapshots = await this.prisma.testCaseSnapshot.findMany({
      where: { id: { in: cases.map((item) => item.snapshotId) }, testPlanId: request.testPlan.id },
      select: { id: true, kind: true },
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

    if (runType === 'SMOKE' && snapshots.some((snapshot) => snapshot.kind !== 'SMOKE')) {
      throw new BadRequestException('Smoke runs can only include smoke snapshots.');
    }
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
        sourceBug: { include: { fixWorkflowRun: { select: { id: true, status: true } } } },
        targets: true,
        executions: { include: { claimedByUser: { select: { id: true, displayName: true } } } },
        cases: { include: { snapshot: true, target: true, assignedToUser: true, activeLease: true, result: { include: { bug: { include: { fixWorkflowRun: { select: { id: true, status: true } } } } } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reportResult(testRunCaseId: string, dto: ReportTestResultDto, userId?: string) {
    return this.prisma.$transaction(async tx => {
    const runCase = await tx.testRunCase.findUnique({
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
    if (runCase.testRun.executionMode === 'LOCAL') throw new BadRequestException('本地轮次必须通过领取会话回传，不能手工覆盖。');
    if (runCase.testRun.status !== 'ACTIVE') {
      throw new BadRequestException('Only active test runs accept results.');
    }
    if (runCase.assignedToUserId && runCase.assignedToUserId !== userId) {
      throw new ForbiddenException('This test case is assigned to another user.');
    }
    if (dto.bugId) {
      const bug = await tx.bug.findFirst({
        where: { id: dto.bugId, projectId: runCase.testRun.testPlan.testRequest.projectId },
      });
      if (!bug) {
        throw new BadRequestException('Bug does not belong to the test request project.');
      }
    }

    const locked = await tx.testRun.updateMany({ where: { id: runCase.testRun.id, status: 'ACTIVE', revision: runCase.testRun.revision }, data: { revision: { increment: 1 } } });
    if (locked.count !== 1) throw new ConflictException('测试轮次已变化，请刷新后重试。');

    const result = await tx.testResult.upsert({
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

    const runCases = await tx.testRunCase.findMany({
      where: { testRunId: runCase.testRun.id },
      include: { result: true },
    });
    if (runCases.length && runCases.every((item) => item.result)) {
      const finalStatus = aggregateResult(runCases.map((item) => item.result!.result));
      await tx.testRun.update({
        where: { id: runCase.testRun.id },
        data: { status: finalStatus, completedAt: new Date() },
      });
      const testRequestStatus = await refreshTestRequestStatus(tx, runCase.testRun.testPlan.testRequest.id);
      return { result, runStatus: finalStatus, testRequestStatus };
    }
    return { result, runStatus: 'ACTIVE', testRequestStatus: TestRequestStatus.IN_TEST };
    });
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
