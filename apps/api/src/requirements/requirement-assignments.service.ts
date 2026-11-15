import { parsePagination, pageResult, type PaginationQuery } from '../common/pagination';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseAssignmentDate } from '../common/business-days';
import { RequirementPlanningStatus } from '../common/enums';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertRequirementAssignmentDto } from './dto/upsert-requirement-assignment.dto';
import { toRequirementAssignmentResponse } from './requirement-assignment.mapper';

@Injectable()
export class RequirementAssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPage(workItemId: string, query: PaginationQuery = {}) {
    const paging = parsePagination(query);
    await this.ensureRequirement(workItemId);
    const rows = await this.prisma.requirementAssignment.findMany({
      skip: paging.skip, take: paging.take,
      where: { workItemId },
      include: { user: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    const total = await this.prisma.requirementAssignment.count({ where: { workItemId } });
    // SQLite 中日期以毫秒存储；按服务端日历计算工作日，并在数据库汇总完整范围。
    const remainderTerms = Array.from({ length: 6 }, (_, offset) => Prisma.sql`CASE WHEN days % 7 > ${offset} AND (startDay + ${offset}) % 7 NOT IN (0, 6) THEN 1 ELSE 0 END`);
    const summary = await this.prisma.$queryRaw<Array<{ estimatedDays: bigint | number }>>(Prisma.sql`
      WITH ranges AS (
        SELECT CAST(julianday(date(plannedEndDate / 1000, 'unixepoch', 'localtime')) - julianday(date(plannedStartDate / 1000, 'unixepoch', 'localtime')) + 1 AS INTEGER) AS days,
          CAST(strftime('%w', plannedStartDate / 1000, 'unixepoch', 'localtime') AS INTEGER) AS startDay
        FROM RequirementAssignment WHERE workItemId = ${workItemId}
      )
      SELECT COALESCE(SUM(CASE WHEN days <= 0 THEN 0 ELSE CAST(days / 7 AS INTEGER) * 5 + ${Prisma.join(remainderTerms, ' + ')} END), 0) AS estimatedDays FROM ranges
    `);
    return { ...pageResult(rows.map((row) => this.toResponse(row)), total, paging), summary: { estimatedDays: Number(summary[0]?.estimatedDays ?? 0) } };
  }

  async list(workItemId: string) {
    await this.ensureRequirement(workItemId);
    const rows = await this.prisma.requirementAssignment.findMany({
      where: { workItemId },
      include: { user: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.toResponse(row));
  }

  async create(workItemId: string, dto: UpsertRequirementAssignmentDto) {
    await this.ensureRequirement(workItemId);
    this.assertValidDateRange(dto.plannedStartDate, dto.plannedEndDate);
    await this.assertUserAssignable(dto.userId);

    const created = await this.prisma.requirementAssignment.create({
      data: {
        workItemId,
        userId: dto.userId,
        role: dto.role,
        plannedStartDate: parseAssignmentDate(dto.plannedStartDate),
        plannedEndDate: parseAssignmentDate(dto.plannedEndDate),
        note: dto.note?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        colorToken: dto.colorToken?.trim() || null,
      },
      include: { user: true },
    });
    await this.syncPlanningStatus(workItemId);
    return this.toResponse(created);
  }

  async update(
    workItemId: string,
    assignmentId: string,
    dto: UpsertRequirementAssignmentDto,
  ) {
    await this.ensureAssignment(workItemId, assignmentId);
    this.assertValidDateRange(dto.plannedStartDate, dto.plannedEndDate);
    await this.assertUserAssignable(dto.userId);

    const updated = await this.prisma.requirementAssignment.update({
      where: { id: assignmentId },
      data: {
        userId: dto.userId,
        role: dto.role,
        plannedStartDate: parseAssignmentDate(dto.plannedStartDate),
        plannedEndDate: parseAssignmentDate(dto.plannedEndDate),
        note: dto.note?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        colorToken: dto.colorToken?.trim() || null,
      },
      include: { user: true },
    });
    await this.syncPlanningStatus(workItemId);
    return this.toResponse(updated);
  }

  async remove(workItemId: string, assignmentId: string) {
    await this.ensureAssignment(workItemId, assignmentId);
    await this.prisma.requirementAssignment.delete({ where: { id: assignmentId } });
    await this.syncPlanningStatus(workItemId);
    return { ok: true };
  }

  async syncPlanningStatus(workItemId: string) {
    const count = await this.prisma.requirementAssignment.count({ where: { workItemId } });
    const requirement = await this.prisma.workItem.findUnique({
      where: { id: workItemId },
      select: { planningStatus: true },
    });
    if (!requirement) {
      return;
    }

    const manualStatuses = new Set<string>([
      RequirementPlanningStatus.IN_PROGRESS,
      RequirementPlanningStatus.DONE,
    ]);
    if (manualStatuses.has(requirement.planningStatus)) {
      if (count === 0) {
        await this.prisma.workItem.update({
          where: { id: workItemId },
          data: { planningStatus: RequirementPlanningStatus.UNSCHEDULED },
        });
      }
      return;
    }

    await this.prisma.workItem.update({
      where: { id: workItemId },
      data: {
        planningStatus:
          count > 0
            ? RequirementPlanningStatus.SCHEDULED
            : RequirementPlanningStatus.UNSCHEDULED,
      },
    });
  }

  private toResponse(
    row: Prisma.RequirementAssignmentGetPayload<{ include: { user: true } }>,
  ) {
    return toRequirementAssignmentResponse(row);
  }

  private assertValidDateRange(start: string, end: string) {
    if (parseAssignmentDate(end) < parseAssignmentDate(start)) {
      throw new BadRequestException('plannedEndDate must be on or after plannedStartDate.');
    }
  }

  private async ensureRequirement(workItemId: string) {
    const requirement = await this.prisma.workItem.findUnique({ where: { id: workItemId } });
    if (!requirement) {
      throw new NotFoundException('Requirement not found.');
    }
  }

  private async ensureAssignment(workItemId: string, assignmentId: string) {
    const assignment = await this.prisma.requirementAssignment.findFirst({
      where: { id: assignmentId, workItemId },
    });
    if (!assignment) {
      throw new NotFoundException('Requirement assignment not found.');
    }
  }

  private async assertUserAssignable(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
  }
}
