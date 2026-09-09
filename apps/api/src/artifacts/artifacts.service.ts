import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  ArtifactStatus,
  ArtifactStorageProvider as ArtifactStorageProviderName,
  ArtifactType,
} from '@flowx-ai/protocol';
import {
  ExecutionSessionsService,
  type ExecutionSessionScope,
} from '../execution-sessions/execution-sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ARTIFACT_STORAGE_PROVIDER,
  type ArtifactStorageProvider,
} from './artifact-storage.provider';
import type { RegisterArtifactDto } from './dto/register-artifact.dto';
import {
  MAX_MANAGED_ARTIFACT_BYTES,
  type CreateArtifactUploadDto,
} from './dto/create-artifact-upload.dto';

export type ArtifactRegistrationInput = {
  artifactType: ArtifactType;
  name: string;
  version?: string;
  storageProvider: ArtifactStorageProviderName;
  storageKey?: string | null;
  externalUrl?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  sha256?: string | null;
  status?: ArtifactStatus;
  metadata?: Record<string, unknown> | null;
};

export type WorkflowArtifactRegistrationInput = ArtifactRegistrationInput & {
  workflowRunId: string;
  executionSessionId?: string | null;
  createdByUserId?: string | null;
};

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executionSessionsService: ExecutionSessionsService,
    @Inject(ARTIFACT_STORAGE_PROVIDER)
    private readonly localStorage: ArtifactStorageProvider,
  ) {}

  async registerForSession(
    executionSessionId: string,
    input: RegisterArtifactDto | ArtifactRegistrationInput,
    scope: ExecutionSessionScope = {},
  ) {
    const session = await this.executionSessionsService.requireAccessibleSession(
      executionSessionId,
      scope,
    );
    if (!session.workspaceId) {
      throw new BadRequestException('Execution session is not associated with a workspace.');
    }

    return this.register({
      ...input,
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      workflowRunId: session.workflowRunId,
      executionSessionId,
      createdByUserId: scope.userId ?? null,
    });
  }

  async createManagedUpload(
    executionSessionId: string,
    input: CreateArtifactUploadDto,
    scope: ExecutionSessionScope = {},
  ) {
    const session = await this.executionSessionsService.requireAccessibleSession(
      executionSessionId,
      scope,
    );
    if (!session.workspaceId) {
      throw new BadRequestException('Execution session is not associated with a workspace.');
    }
    const artifactId = createHash('sha256')
      .update(`${executionSessionId}:${input.artifactType}:${input.sha256.toLowerCase()}`)
      .digest('hex')
      .slice(0, 32);
    const storageName = sanitizeStorageName(input.name);
    const artifact = await this.register({
      artifactType: input.artifactType,
      name: input.name,
      version: input.version,
      storageProvider: 'local',
      storageKey: `managed/${executionSessionId}/${artifactId}/${storageName}`,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      status: 'PENDING',
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      workflowRunId: session.workflowRunId,
      executionSessionId,
      createdByUserId: scope.userId ?? null,
    }, artifactId);
    return {
      artifact,
      upload: {
        method: 'PUT' as const,
        path: `/artifacts/${artifact.id}/content`,
        contentType: input.mimeType?.trim() || 'application/octet-stream',
      },
    };
  }

  async writeManagedContent(
    artifactId: string,
    content: Buffer,
    scope: ExecutionSessionScope = {},
  ) {
    if (content.byteLength > MAX_MANAGED_ARTIFACT_BYTES) {
      throw new BadRequestException('Artifact content exceeds the 100 MB upload limit.');
    }
    const artifact = await this.findOne(artifactId, scope);
    if (artifact.storageProvider !== 'local' || !artifact.storageKey?.startsWith('managed/')) {
      throw new BadRequestException('Artifact does not accept managed content uploads.');
    }
    const byteSize = content.byteLength;
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (artifact.byteSize != null && artifact.byteSize !== byteSize) {
      throw new BadRequestException('Uploaded artifact size does not match the declaration.');
    }
    if (artifact.sha256 && artifact.sha256.toLowerCase() !== sha256) {
      throw new BadRequestException('Uploaded artifact sha256 does not match the declaration.');
    }
    if (artifact.status === 'AVAILABLE') return artifact;
    if (artifact.status !== 'PENDING') {
      throw new BadRequestException('Artifact is not waiting for managed content upload.');
    }
    const stored = await this.localStorage.write(artifact.storageKey, content);
    return this.prisma.artifact.update({
      where: { id: artifactId },
      data: {
        status: 'AVAILABLE',
        byteSize: stored.byteSize,
        sha256: stored.sha256,
      },
    });
  }

  async registerWorkflowArtifact(input: WorkflowArtifactRegistrationInput) {
    const workflow = await this.prisma.workflowRun.findUnique({
      where: { id: input.workflowRunId },
      select: {
        requirement: {
          select: {
            workspaceId: true,
            projectId: true,
            project: { select: { workspaceId: true } },
          },
        },
      },
    });
    if (!workflow) {
      throw new NotFoundException('Workflow run not found.');
    }
    return this.register({
      ...input,
      workspaceId: workflow.requirement.workspaceId ?? workflow.requirement.project.workspaceId,
      projectId: workflow.requirement.projectId,
    });
  }

  async createServerGeneratedArtifact(input: {
    workspaceId: string;
    projectId?: string | null;
    workflowRunId?: string | null;
    artifactType: ArtifactType;
    name: string;
    version: string;
    mimeType: string;
    content: Buffer;
    metadata?: Record<string, unknown>;
    createdByUserId?: string | null;
  }) {
    const artifactId = randomUUID();
    const storageKey = `managed/server/${artifactId}/${sanitizeStorageName(input.name)}`;
    const stored = await this.localStorage.write(storageKey, input.content);
    return this.register(
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        executionSessionId: null,
        artifactType: input.artifactType,
        name: input.name,
        version: input.version,
        storageProvider: 'local',
        storageKey,
        mimeType: input.mimeType,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        status: 'AVAILABLE',
        metadata: input.metadata,
        createdByUserId: input.createdByUserId ?? null,
      },
      artifactId,
    );
  }

  async findOne(id: string, scope: ExecutionSessionScope = {}) {
    const artifact = await this.prisma.artifact.findUnique({
      where: { id },
      include: {
        executionSession: { select: { organizationId: true } },
      },
    });
    if (!artifact || artifact.status === 'DELETED') {
      throw new NotFoundException('Artifact not found.');
    }
    this.assertOrganizationAccess(artifact.executionSession?.organizationId ?? null, scope);
    return artifact;
  }

  async list(
    filters: {
      workflowRunId?: string;
      executionSessionId?: string;
      artifactType?: ArtifactType;
      take?: number;
    },
    scope: ExecutionSessionScope = {},
  ) {
    if (filters.executionSessionId) {
      await this.executionSessionsService.requireAccessibleSession(filters.executionSessionId, scope);
    }
    const take = Math.min(Math.max(filters.take ?? 50, 1), 100);
    return this.prisma.artifact.findMany({
      where: {
        status: { not: 'DELETED' },
        workflowRunId: filters.workflowRunId,
        executionSessionId: filters.executionSessionId,
        artifactType: filters.artifactType,
        ...(scope.organizationId && !filters.executionSessionId
          ? {
              OR: [
                { executionSessionId: null },
                { executionSession: { organizationId: scope.organizationId } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async readLocalContent(id: string, scope: ExecutionSessionScope = {}) {
    const artifact = await this.findOne(id, scope);
    if (artifact.storageProvider !== 'local' || !artifact.storageKey) {
      throw new BadRequestException('Artifact does not use local storage.');
    }
    return {
      artifact,
      content: await this.localStorage.read(artifact.storageKey),
    };
  }

  async markDeleted(id: string, scope: ExecutionSessionScope = {}) {
    await this.findOne(id, scope);
    return this.prisma.artifact.update({
      where: { id },
      data: { status: 'DELETED' },
    });
  }

  private async register(
    input: ArtifactRegistrationInput & {
      workspaceId: string;
      projectId?: string | null;
      workflowRunId?: string | null;
      executionSessionId?: string | null;
      createdByUserId?: string | null;
    },
    id?: string,
  ) {
    const reference = this.validateReference(input);
    const sha256 = input.sha256?.trim().toLowerCase() || null;
    if (sha256) {
      const duplicate = await this.prisma.artifact.findFirst({
        where: {
          workspaceId: input.workspaceId,
          workflowRunId: input.workflowRunId ?? null,
          executionSessionId: input.executionSessionId ?? null,
          artifactType: input.artifactType,
          sha256,
          status: { not: 'DELETED' },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) {
        if (
          duplicate.storageProvider !== input.storageProvider ||
          duplicate.storageKey !== reference.storageKey ||
          duplicate.externalUrl !== reference.externalUrl
        ) {
          throw new ConflictException({
            code: 'ARTIFACT_INVALID_REFERENCE',
            message: 'The same artifact digest is already registered with another reference.',
          });
        }
        return duplicate;
      }
    }

    return this.prisma.artifact.create({
      data: {
        ...(id ? { id } : {}),
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        executionSessionId: input.executionSessionId ?? null,
        artifactType: input.artifactType,
        name: input.name.trim(),
        version: input.version?.trim() || '1',
        storageProvider: input.storageProvider,
        storageKey: reference.storageKey,
        externalUrl: reference.externalUrl,
        mimeType: input.mimeType?.trim() || null,
        byteSize: input.byteSize ?? null,
        sha256,
        status: input.status ?? 'AVAILABLE',
        metadata: toInputJson(input.metadata),
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  private validateReference(input: ArtifactRegistrationInput) {
    const storageKey = input.storageKey?.trim() || null;
    const externalUrl = input.externalUrl?.trim() || null;
    if (externalUrl) {
      this.validateExternalUrl(externalUrl);
    }

    if (input.storageProvider === 'local') {
      if (!storageKey) {
        throw this.invalidReference('Local artifacts require storageKey.');
      }
      this.localStorage.resolvePath(storageKey);
      return { storageKey, externalUrl };
    }
    if (input.storageProvider === 'external') {
      if (!externalUrl) {
        throw this.invalidReference('External artifacts require an HTTP(S) URL.');
      }
      return { storageKey: null, externalUrl };
    }
    if (!storageKey) {
      throw this.invalidReference(`${input.storageProvider} artifacts require storageKey.`);
    }
    return { storageKey, externalUrl };
  }

  private validateExternalUrl(value: string) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('unsupported URL');
      }
    } catch {
      throw this.invalidReference('Artifact externalUrl must be a public HTTP(S) URL.');
    }
  }

  private invalidReference(message: string) {
    return new BadRequestException({ code: 'ARTIFACT_INVALID_REFERENCE', message });
  }

  private assertOrganizationAccess(
    artifactOrganizationId: string | null,
    scope: ExecutionSessionScope,
  ) {
    if (artifactOrganizationId && artifactOrganizationId !== scope.organizationId?.trim()) {
      throw new ForbiddenException('Artifact belongs to another organization.');
    }
  }
}

function sanitizeStorageName(value: string): string {
  const normalized = value.trim().split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]+/g, '-') ?? '';
  return normalized.replace(/^\.+/, '').slice(0, 180) || 'artifact.bin';
}

function toInputJson(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  return value == null ? undefined : (value as Prisma.InputJsonObject);
}
