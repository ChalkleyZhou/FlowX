import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { parseAssignmentDate } from '../common/business-days';
import { RequirementPlanningStatus } from '../common/enums';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertRequirementAssignmentDto } from './dto/upsert-requirement-assignment.dto';
import { toRequirementAssignmentResponse } from './requirement-assignment.mapper';

@Injectable()
export class RequirementAssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(requirementId: string) {
    await this.ensureRequirement(requirementId);
    const rows = await this.prisma.requirementAssignment.findMany({
      where: { requirementId },
      include: { user: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.toResponse(row));
  }

  async create(requirementId: string, dto: UpsertRequirementAssignmentDto) {
    await this.ensureRequirement(requirementId);
    this.assertValidDateRange(dto.plannedStartDate, dto.plannedEndDate);
    await this.assertUserAssignable(dto.userId);

    const created = await this.prisma.requirementAssignment.create({
      data: {
        requirementId,
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
    await this.syncPlanningStatus(requirementId);
    return this.toResponse(created);
  }

  async update(
    requirementId: string,
    assignmentId: string,
    dto: UpsertRequirementAssignmentDto,
  ) {
    await this.ensureAssignment(requirementId, assignmentId);
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
    await this.syncPlanningStatus(requirementId);
    return this.toResponse(updated);
  }

  async remove(requirementId: string, assignmentId: string) {
    await this.ensureAssignment(requirementId, assignmentId);
    await this.prisma.requirementAssignment.delete({ where: { id: assignmentId } });
    await this.syncPlanningStatus(requirementId);
    return { ok: true };
  }

  async syncPlanningStatus(requirementId: string) {
    const count = await this.prisma.requirementAssignment.count({ where: { requirementId } });
    const requirement = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
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
        await this.prisma.requirement.update({
          where: { id: requirementId },
          data: { planningStatus: RequirementPlanningStatus.UNSCHEDULED },
        });
      }
      return;
    }

    await this.prisma.requirement.update({
      where: { id: requirementId },
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

  private async ensureRequirement(requirementId: string) {
    const requirement = await this.prisma.requirement.findUnique({ where: { id: requirementId } });
    if (!requirement) {
      throw new NotFoundException('Requirement not found.');
    }
  }

  private async ensureAssignment(requirementId: string, assignmentId: string) {
    const assignment = await this.prisma.requirementAssignment.findFirst({
      where: { id: assignmentId, requirementId },
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
