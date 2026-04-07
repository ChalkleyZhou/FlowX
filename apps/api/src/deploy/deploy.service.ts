import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PreviewDeployJobDto } from './dto/preview-deploy-job.dto';
import { UpdateRepositoryDeployConfigDto } from './dto/update-repository-deploy-config.dto';
import { DeployProviderRegistryService } from './providers/provider-registry.service';
import { DeployResolvedJobInput } from './providers/deploy-provider.interface';

type DeploySessionLike = {
  user?: {
    id?: string;
    displayName?: string;
  };
};

@Injectable()
export class DeployService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: DeployProviderRegistryService,
  ) {}

  listProviders() {
    return {
      defaultProvider: this.providerRegistry.getDefaultProviderId(),
      providers: this.providerRegistry.listProviders(),
    };
  }

  async getRepositoryConfig(repositoryId: string) {
    await this.ensureRepositoryExists(repositoryId);

    const config = await this.prisma.repositoryDeployConfig.findUnique({
      where: { repositoryId },
    });

    return (
      config ?? {
        repositoryId,
        enabled: false,
        provider: this.providerRegistry.getDefaultProviderId(),
        configJson: {},
        createdAt: null,
        updatedAt: null,
      }
    );
  }

  async upsertRepositoryConfig(repositoryId: string, dto: UpdateRepositoryDeployConfigDto) {
    await this.ensureRepositoryExists(repositoryId);

    const existing = await this.prisma.repositoryDeployConfig.findUnique({
      where: { repositoryId },
    });

    const provider = dto.provider?.trim() || existing?.provider || this.providerRegistry.getDefaultProviderId();

    return this.prisma.repositoryDeployConfig.upsert({
      where: { repositoryId },
        create: {
          repositoryId,
          enabled: dto.enabled ?? existing?.enabled ?? false,
          provider,
          configJson: this.toJsonObject(
            dto.config ?? (existing?.configJson as Record<string, unknown> | undefined) ?? {},
          ),
        },
        update: {
          enabled: dto.enabled ?? existing?.enabled ?? false,
          provider,
          configJson: this.toJsonObject(
            dto.config ?? (existing?.configJson as Record<string, unknown> | undefined) ?? {},
          ),
        },
      });
  }

  async previewJob(repositoryId: string, dto: PreviewDeployJobDto, session?: DeploySessionLike) {
    const resolved = await this.resolveJobInput(repositoryId, dto, session);
    const provider = this.providerRegistry.getProvider(resolved.provider);
    const preview = await provider.preview(resolved);

    return {
      repositoryId,
      provider: resolved.provider,
      enabled: true,
      preview,
    };
  }

  async createJob(repositoryId: string, dto: PreviewDeployJobDto, session?: DeploySessionLike) {
    const resolved = await this.resolveJobInput(repositoryId, dto, session);
    const provider = this.providerRegistry.getProvider(resolved.provider);
    const preview = await provider.preview(resolved);

    try {
      const result = await provider.createJob(resolved);

      const record = await this.prisma.deployJobRecord.create({
        data: {
          projectId: resolved.projectId ?? null,
          repositoryId,
          workflowRunId: resolved.workflowRunId ?? null,
          provider: resolved.provider,
          status: provider.id === 'noop' ? 'RECORDED' : 'TRIGGERED',
          targetEnv: resolved.env ?? null,
          branch: resolved.branch ?? null,
          commitSha: resolved.commit ?? null,
          version: resolved.version ?? null,
          versionImage: resolved.versionImage ?? null,
          image: resolved.image ?? null,
          requestedBy: session?.user?.id?.trim() || null,
          requestPayload: this.toJsonObject(result.payload),
          responsePayload:
            result.response === undefined
              ? undefined
              : this.toNullableJsonValue(result.response),
          externalJobId: result.externalJobId ?? null,
          externalJobUrl: result.externalJobUrl ?? null,
        },
        include: {
          project: true,
          repository: true,
        },
      });

      return {
        message: provider.id === 'noop' ? '部署请求已记录，当前未接入真实发布平台。' : '部署任务已创建。',
        job: record,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const record = await this.prisma.deployJobRecord.create({
        data: {
          projectId: resolved.projectId ?? null,
          repositoryId,
          workflowRunId: resolved.workflowRunId ?? null,
          provider: resolved.provider,
          status: 'FAILED',
          targetEnv: resolved.env ?? null,
          branch: resolved.branch ?? null,
          commitSha: resolved.commit ?? null,
          version: resolved.version ?? null,
          versionImage: resolved.versionImage ?? null,
          image: resolved.image ?? null,
          requestedBy: session?.user?.id?.trim() || null,
          requestPayload: this.toJsonObject(preview.payload),
          errorMessage: message,
        },
        include: {
          project: true,
          repository: true,
        },
      });

      throw new BadRequestException({
        message,
        job: record,
      });
    }
  }

  async listJobs(repositoryId: string) {
    await this.ensureRepositoryExists(repositoryId);

    return this.prisma.deployJobRecord.findMany({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async resolveJobInput(repositoryId: string, dto: PreviewDeployJobDto, session?: DeploySessionLike) {
    const repositoryConfig = await this.prisma.repositoryDeployConfig.findUnique({
      where: { repositoryId },
    });

    const providerId =
      repositoryConfig?.provider?.trim() || this.providerRegistry.getDefaultProviderId();

    if (!repositoryConfig?.enabled) {
      throw new BadRequestException('当前仓库尚未启用部署配置。');
    }

    const config = this.ensurePlainObject(repositoryConfig.configJson);
    const overrides = this.ensurePlainObject(dto.overrides);
    const env = dto.env?.trim() || this.readString(config.env);

    return {
      repositoryId,
      projectId: dto.projectId?.trim() || null,
      workflowRunId: dto.workflowRunId?.trim() || null,
      provider: providerId,
      requestedBy: session?.user?.id?.trim() || null,
      env,
      branch: dto.branch?.trim() || null,
      commit: dto.commit?.trim() || null,
      version: dto.version?.trim() || null,
      versionImage: dto.versionImage?.trim() || null,
      image: dto.image?.trim() || null,
      config,
      overrides,
    } satisfies DeployResolvedJobInput;
  }

  private async ensureRepositoryExists(repositoryId: string) {
    const repository = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new NotFoundException('Repository not found.');
    }
  }

  private ensurePlainObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
    return value as Prisma.InputJsonObject;
  }

  private toNullableJsonValue(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    if (value === null) {
      return Prisma.JsonNull;
    }

    return value as Prisma.InputJsonValue;
  }
}
