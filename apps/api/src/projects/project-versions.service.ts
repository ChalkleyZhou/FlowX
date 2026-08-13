import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectVersionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string) {
    await this.requireProject(projectId);
    return this.prisma.projectVersion.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(projectId: string, dto: { name: string }) {
    await this.requireProject(projectId);
    const name = this.normalizeName(dto.name);
    try {
      return await this.prisma.projectVersion.create({ data: { projectId, name } });
    } catch (error) {
      this.rethrowDuplicate(error);
    }
  }

  async update(projectId: string, versionId: string, dto: { name: string }) {
    await this.requireOwnedVersion(projectId, versionId);
    const name = this.normalizeName(dto.name);
    try {
      return await this.prisma.projectVersion.update({ where: { id: versionId }, data: { name } });
    } catch (error) {
      this.rethrowDuplicate(error);
    }
  }

  async remove(projectId: string, versionId: string) {
    const project = await this.requireProject(projectId);
    await this.requireOwnedVersion(projectId, versionId);
    if (project.currentVersionId === versionId) {
      throw new ConflictException("Cannot delete the project's current version.");
    }
    const assigned = await this.prisma.requirement.count({ where: { versionId } });
    if (assigned > 0) {
      throw new ConflictException('Cannot delete a version that is still assigned to requirements.');
    }
    await this.prisma.projectVersion.delete({ where: { id: versionId } });
    return { ok: true as const };
  }

  async setCurrentVersion(projectId: string, currentVersionId: string | null) {
    await this.requireProject(projectId);
    if (currentVersionId !== null) {
      await this.requireOwnedVersion(projectId, currentVersionId, true);
    }
    return this.prisma.project.update({
      where: { id: projectId },
      data: { currentVersionId },
      include: this.projectVersionInclude(),
    });
  }

  private projectVersionInclude() {
    return {
      currentVersion: { select: { id: true, name: true } },
      versions: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' as const } },
    };
  }

  private normalizeName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('Version name is required.');
    }
    return trimmed;
  }

  private async requireProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, currentVersionId: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
    return project;
  }

  private async requireOwnedVersion(projectId: string, versionId: string, asBadRequest = false) {
    const version = await this.prisma.projectVersion.findFirst({ where: { id: versionId, projectId } });
    if (!version) {
      if (asBadRequest) {
        throw new BadRequestException('Version does not belong to this project.');
      }
      throw new NotFoundException('Version not found.');
    }
    return version;
  }

  private rethrowDuplicate(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A version with this name already exists in the project.');
    }
    throw error;
  }
}
