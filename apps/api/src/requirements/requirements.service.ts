import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequirementDto } from './dto/create-requirement.dto';

@Injectable()
export class RequirementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateRequirementDto) {
    return this.prisma.requirement.create({
      data: {
        title: dto.title,
        description: dto.description,
        acceptanceCriteria: dto.acceptanceCriteria,
      },
    });
  }

  async findAll() {
    return this.prisma.requirement.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
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
        workflowRuns: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }
}

