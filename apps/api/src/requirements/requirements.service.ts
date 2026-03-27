import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequirementDto } from './dto/create-requirement.dto';

@Injectable()
export class RequirementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateRequirementDto) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: dto.workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found.');
    }

    return this.prisma.requirement.create({
      data: {
        title: dto.title,
        description: dto.description,
        acceptanceCriteria: dto.acceptanceCriteria,
        workspaceId: dto.workspaceId,
      },
      include: {
        workspace: true,
      },
    });
  }

  async findAll() {
    return this.prisma.requirement.findMany({
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
        workflowRuns: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.requirement.findUniqueOrThrow({
      where: { id },
      include: {
        workspace: {
          include: {
            repositories: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        workflowRuns: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }
}
