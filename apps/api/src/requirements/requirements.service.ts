import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequirementDto } from './dto/create-requirement.dto';

@Injectable()
export class RequirementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateRequirementDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: {
        workspace: {
          include: {
            repositories: {
              where: { status: 'ACTIVE' },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    const requestedRepositoryIds = Array.from(
      new Set((dto.repositoryIds ?? []).map((value) => value.trim()).filter(Boolean)),
    );
    const allowedRepositoryIds = new Set(
      project.workspace.repositories.map((repository) => repository.id),
    );
    const invalidRepositoryIds = requestedRepositoryIds.filter(
      (repositoryId) => !allowedRepositoryIds.has(repositoryId),
    );

    if (invalidRepositoryIds.length > 0) {
      throw new NotFoundException('One or more selected repositories do not belong to the project workspace.');
    }

    return this.prisma.requirement.create({
      data: {
        projectId: dto.projectId,
        title: dto.title,
        description: dto.description,
        acceptanceCriteria: dto.acceptanceCriteria,
        workspaceId: project.workspaceId,
        requirementRepositories:
          requestedRepositoryIds.length > 0
            ? {
                create: requestedRepositoryIds.map((repositoryId) => ({
                  repositoryId,
                })),
              }
            : undefined,
      },
      include: {
        project: {
          include: {
            workspace: {
              include: {
                repositories: {
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
        workspace: true,
        requirementRepositories: {
          include: {
            repository: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });
  }

  async findAll() {
    return this.prisma.requirement.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        project: {
          include: {
            workspace: {
              include: {
                repositories: {
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
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
          include: {
            workflowRepositories: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        },
        requirementRepositories: {
          include: {
            repository: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.requirement.findUniqueOrThrow({
      where: { id },
      include: {
        project: {
          include: {
            workspace: {
              include: {
                repositories: {
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
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
          include: {
            workflowRepositories: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        },
        requirementRepositories: {
          include: {
            repository: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });
  }
}
