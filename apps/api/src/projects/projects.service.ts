import { Injectable, NotFoundException } from '@nestjs/common';
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
        _count: {
          select: {
            requirements: true,
          },
        },
      },
    });
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
        _count: {
          select: {
            requirements: true,
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
        requirements: {
          orderBy: { createdAt: 'desc' },
          include: {
            assignments: {
              include: { user: true },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            },
          },
        },
        _count: {
          select: {
            requirements: true,
          },
        },
      },
    });

    return {
      ...project,
      requirements: project.requirements.map((requirement) => ({
        ...requirement,
        assignments: requirement.assignments.map((assignment) => ({
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
        scheduleSummary: summarizeRequirementSchedule(requirement.assignments),
      })),
    };
  }
}
