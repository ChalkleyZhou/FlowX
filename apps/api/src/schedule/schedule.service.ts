import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  countBusinessDays,
  estimateHoursFromRange,
  formatCalendarDate,
  parseAssignmentDate,
} from '../common/business-days';
import { RequirementAssignmentRole } from '../common/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { GetScheduleGanttQuery } from './schedule.types';
import type { GanttBar, GanttLane, GanttPayload } from './schedule.types';

const ROLE_COLORS: Record<string, string> = {
  [RequirementAssignmentRole.PM]: 'role-pm',
  [RequirementAssignmentRole.FRONTEND]: 'role-frontend',
  [RequirementAssignmentRole.BACKEND]: 'role-backend',
  [RequirementAssignmentRole.FULLSTACK]: 'role-fullstack',
  [RequirementAssignmentRole.QA]: 'role-qa',
  [RequirementAssignmentRole.DESIGN]: 'role-design',
  [RequirementAssignmentRole.OTHER]: 'role-other',
};

type AssignmentRow = {
  id: string;
  requirementId: string;
  userId: string;
  role: string;
  plannedStartDate: Date;
  plannedEndDate: Date;
  colorToken: string | null;
  user: { displayName: string };
  requirement: { title: string; projectId: string; project: { id: string; name: string } };
};

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async buildGanttPayload(query: GetScheduleGanttQuery): Promise<GanttPayload> {
    if (parseAssignmentDate(query.to) < parseAssignmentDate(query.from)) {
      throw new BadRequestException('Query range "to" must be on or after "from".');
    }

    const scope = query.scope ?? 'project';

    if (scope === 'project') {
      if (!query.projectId) {
        throw new BadRequestException('projectId is required when scope is project.');
      }
      if (query.view !== 'requirement' && query.view !== 'member') {
        throw new BadRequestException('Invalid view.');
      }
      const project = await this.prisma.project.findUnique({ where: { id: query.projectId } });
      if (!project) {
        throw new NotFoundException('Project not found.');
      }
    }

    const assignments = await this.loadAssignments(query, scope);
    const range = { from: query.from, to: query.to };
    const bars: GanttBar[] = [];
    const lanes: GanttLane[] = [];

    if (query.view === 'requirement') {
      const requirementMap = new Map<
        string,
        { title: string; projectName: string; projectId: string; assignments: AssignmentRow[] }
      >();
      for (const assignment of assignments) {
        const bucket = requirementMap.get(assignment.requirementId) ?? {
          title: assignment.requirement.title,
          projectName: assignment.requirement.project.name,
          projectId: assignment.requirement.projectId,
          assignments: [],
        };
        bucket.assignments.push(assignment);
        requirementMap.set(assignment.requirementId, bucket);
      }

      for (const [requirementId, bucket] of requirementMap) {
        const projectId = bucket.projectId;
        const laneId = `req:${requirementId}`;
        const laneLabel =
          scope === 'organization' && !query.projectId
            ? `${bucket.projectName} · ${bucket.title}`
            : bucket.title;
        lanes.push({
          id: laneId,
          kind: 'requirement',
          label: laneLabel,
          meta: { projectId, requirementId },
        });

        const starts = bucket.assignments.map((a) => this.formatGanttDate(a.plannedStartDate));
        const ends = bucket.assignments.map((a) => this.formatGanttDate(a.plannedEndDate));
        const aggregateStart = starts.sort()[0];
        const aggregateEnd = ends.sort().at(-1);
        if (
          aggregateStart &&
          aggregateEnd &&
          this.intersectsRange(aggregateStart, aggregateEnd, range.from, range.to)
        ) {
          bars.push({
            id: `${laneId}:aggregate`,
            laneId,
            label: '整体周期',
            start: aggregateStart,
            end: aggregateEnd,
            estimatedDays: countBusinessDays(aggregateStart, aggregateEnd),
            estimatedHours: estimateHoursFromRange(aggregateStart, aggregateEnd),
            color: 'aggregate',
            meta: {
              projectId,
              requirementId,
              userId: '',
              role: 'AGGREGATE',
            },
          });
        }

        for (const assignment of bucket.assignments) {
          const bar = this.toBar(assignment, laneId);
          if (this.intersectsRange(bar.start, bar.end, range.from, range.to)) {
            bars.push(bar);
          }
        }
      }
    } else {
      const userMap = new Map<string, { displayName: string; assignments: AssignmentRow[] }>();
      for (const assignment of assignments) {
        const bucket = userMap.get(assignment.userId) ?? {
          displayName: assignment.user.displayName,
          assignments: [],
        };
        bucket.assignments.push(assignment);
        userMap.set(assignment.userId, bucket);
      }

      for (const [userId, bucket] of userMap) {
        const laneId = `user:${userId}`;
        lanes.push({
          id: laneId,
          kind: 'member',
          label: bucket.displayName,
          meta: {
            projectId: scope === 'project' ? query.projectId : undefined,
            userId,
          },
        });

        for (const assignment of bucket.assignments) {
          const barLabel =
            scope === 'organization'
              ? `${assignment.requirement.project.name} · ${assignment.requirement.title} · ${assignment.role}`
              : `${assignment.requirement.title} · ${assignment.role}`;
          const bar = this.toBar(assignment, laneId, barLabel);
          if (this.intersectsRange(bar.start, bar.end, range.from, range.to)) {
            bars.push(bar);
          }
        }
      }
    }

    return {
      view: query.view,
      range,
      lanes,
      bars,
    };
  }

  private async loadAssignments(
    query: GetScheduleGanttQuery,
    scope: 'project' | 'organization',
  ): Promise<AssignmentRow[]> {
    if (scope === 'organization') {
      // Global/cross-project: do not require assignee ∈ organization (picker list ≠ visiblity).
      return this.prisma.requirementAssignment.findMany({
        where: {
          requirement: {
            ...(query.projectId ? { projectId: query.projectId } : {}),
            ...(query.requirementId ? { id: query.requirementId } : {}),
          },
          ...(query.userId ? { userId: query.userId } : {}),
          ...(query.role ? { role: query.role } : {}),
        },
        include: {
          requirement: { include: { project: true } },
          user: true,
        },
        orderBy: [{ requirement: { project: { name: 'asc' } } }, { sortOrder: 'asc' }],
      });
    }

    return this.prisma.requirementAssignment.findMany({
      where: {
        requirement: {
          projectId: query.projectId!,
          ...(query.requirementId ? { id: query.requirementId } : {}),
        },
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.role ? { role: query.role } : {}),
      },
      include: {
        requirement: { include: { project: true } },
        user: true,
      },
      orderBy: [{ requirement: { createdAt: 'desc' } }, { sortOrder: 'asc' }],
    });
  }

  /** UTC calendar date — aligns with web gantt viewport (monthRange uses UTC). */
  private formatGanttDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private toBar(assignment: AssignmentRow, laneId: string, label?: string): GanttBar {
    const start = this.formatGanttDate(assignment.plannedStartDate);
    const end = this.formatGanttDate(assignment.plannedEndDate);
    const projectId = assignment.requirement.projectId;
    return {
      id: assignment.id,
      laneId,
      label: label ?? `${assignment.user.displayName} · ${assignment.role}`,
      start,
      end,
      estimatedDays: countBusinessDays(start, end),
      estimatedHours: estimateHoursFromRange(start, end),
      color: assignment.colorToken ?? ROLE_COLORS[assignment.role] ?? 'role-other',
      meta: {
        projectId,
        requirementId: assignment.requirementId,
        userId: assignment.userId,
        role: assignment.role,
      },
    };
  }

  private intersectsRange(start: string, end: string, from: string, to: string) {
    return end >= from && start <= to;
  }
}
