import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCryptoService } from './credential-crypto.service';

export type AiCredentialProvider = 'cursor' | 'codex';

export type CredentialStatusResponse = {
  provider: AiCredentialProvider;
  configured: boolean;
  updatedAt?: string;
};

export type OnlineAiPolicy = {
  preferredProvider: AiCredentialProvider | null;
  defaultProvider: AiCredentialProvider | null;
  onlineAvailable: boolean;
  providers: Array<{
    id: AiCredentialProvider;
    label: string;
    configured: boolean;
    updatedAt?: string;
  }>;
};

const ONLINE_AI_PROVIDERS: AiCredentialProvider[] = ['cursor', 'codex'];

export function parseAiCredentialProvider(provider?: string | null): AiCredentialProvider | null {
  const candidate = provider?.trim().toLowerCase();
  if (candidate === 'cursor' || candidate === 'codex') {
    return candidate;
  }
  return null;
}

function providerLabel(provider: AiCredentialProvider) {
  return provider === 'cursor' ? 'Cursor CLI' : 'Codex';
}

@Injectable()
export class AiCredentialsService {
  private readonly logger = new Logger(AiCredentialsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialCryptoService: CredentialCryptoService,
  ) {}

  async getCursorCredentialStatus(organizationId: string): Promise<CredentialStatusResponse> {
    return this.getCredentialStatus(organizationId, 'cursor');
  }

  async getCodexCredentialStatus(organizationId: string): Promise<CredentialStatusResponse> {
    return this.getCredentialStatus(organizationId, 'codex');
  }

  async upsertCursorCredential(organizationId: string, apiKey: string): Promise<CredentialStatusResponse> {
    return this.upsertCredential(organizationId, 'cursor', apiKey);
  }

  async upsertCodexCredential(organizationId: string, apiKey: string): Promise<CredentialStatusResponse> {
    return this.upsertCredential(organizationId, 'codex', apiKey);
  }

  async deleteCursorCredential(organizationId: string): Promise<CredentialStatusResponse> {
    return this.deleteCredential(organizationId, 'cursor');
  }

  async deleteCodexCredential(organizationId: string): Promise<CredentialStatusResponse> {
    return this.deleteCredential(organizationId, 'codex');
  }

  async getCursorApiKeyForOrganization(organizationId: string): Promise<string | null> {
    return this.getApiKeyForOrganization(organizationId, 'cursor');
  }

  async getCodexApiKeyForOrganization(organizationId: string): Promise<string | null> {
    return this.getApiKeyForOrganization(organizationId, 'codex');
  }

  async getOnlineAiPolicy(organizationId: string): Promise<OnlineAiPolicy> {
    const [credentials, organization] = await Promise.all([
      this.prisma.organizationAiCredential.findMany({
        where: { organizationId, provider: { in: [...ONLINE_AI_PROVIDERS] } },
        select: { provider: true, updatedAt: true },
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { preferredAiProvider: true },
      }),
    ]);
    const updatedAtByProvider = new Map(credentials.map((item) => [item.provider, item.updatedAt]));
    const providers = ONLINE_AI_PROVIDERS.map((id) => {
      const updatedAt = updatedAtByProvider.get(id);
      return {
        id,
        label: providerLabel(id),
        configured: Boolean(updatedAt),
        ...(updatedAt ? { updatedAt: updatedAt.toISOString() } : {}),
      };
    });
    const configured = providers.filter((item) => item.configured).map((item) => item.id);
    const stored = parseAiCredentialProvider(organization?.preferredAiProvider);
    const preferredProvider = stored && configured.includes(stored) ? stored : null;
    const defaultProvider = preferredProvider ?? (configured.length === 1 ? configured[0]! : null);
    return {
      preferredProvider,
      defaultProvider,
      onlineAvailable: configured.length > 0,
      providers,
    };
  }

  async setPreferredProvider(organizationId: string, provider: AiCredentialProvider): Promise<OnlineAiPolicy> {
    const policy = await this.getOnlineAiPolicy(organizationId);
    if (!policy.providers.some((item) => item.id === provider && item.configured)) {
      throw new BadRequestException(`当前组织未配置 ${providerLabel(provider)} 凭据，不能设为优先。`);
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { preferredAiProvider: provider },
    });
    return this.getOnlineAiPolicy(organizationId);
  }

  private async getCredentialStatus(
    organizationId: string,
    provider: AiCredentialProvider,
  ): Promise<CredentialStatusResponse> {
    const record = await this.prisma.organizationAiCredential.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider,
        },
      },
      select: {
        updatedAt: true,
      },
    });

    if (!record) {
      return { provider, configured: false };
    }

    return {
      provider,
      configured: true,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private async upsertCredential(
    organizationId: string,
    provider: AiCredentialProvider,
    apiKey: string,
  ): Promise<CredentialStatusResponse> {
    const encryptedSecret = this.credentialCryptoService.encrypt(apiKey);
    const updated = await this.prisma.organizationAiCredential.upsert({
      where: {
        organizationId_provider: {
          organizationId,
          provider,
        },
      },
      create: {
        organizationId,
        provider,
        encryptedSecret,
        keyVersion: 1,
      },
      update: {
        encryptedSecret,
        keyVersion: 1,
      },
      select: {
        updatedAt: true,
      },
    });

    this.logger.log(`Stored ${provider} credential for organization ${organizationId}.`);
    await this.reconcilePreferredProvider(organizationId, provider);

    return {
      provider,
      configured: true,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private async deleteCredential(
    organizationId: string,
    provider: AiCredentialProvider,
  ): Promise<CredentialStatusResponse> {
    await this.prisma.organizationAiCredential.deleteMany({
      where: {
        organizationId,
        provider,
      },
    });

    this.logger.log(`Deleted ${provider} credential for organization ${organizationId}.`);
    await this.reconcilePreferredProvider(organizationId, null);

    return {
      provider,
      configured: false,
    };
  }

  private async reconcilePreferredProvider(organizationId: string, fallback: AiCredentialProvider | null) {
    const [credentials, organization] = await Promise.all([
      this.prisma.organizationAiCredential.findMany({
        where: { organizationId, provider: { in: [...ONLINE_AI_PROVIDERS] } },
        select: { provider: true },
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { preferredAiProvider: true },
      }),
    ]);
    const configured = credentials
      .map((item) => parseAiCredentialProvider(item.provider))
      .filter((item): item is AiCredentialProvider => item !== null);
    const stored = parseAiCredentialProvider(organization?.preferredAiProvider);
    const valid = stored && configured.includes(stored) ? stored : null;
    const next = valid
      ?? (fallback && configured.includes(fallback) ? fallback : null)
      ?? (configured.length === 1 ? configured[0]! : null);
    if (next === stored) {
      return;
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { preferredAiProvider: next },
    });
  }

  private async getApiKeyForOrganization(
    organizationId: string,
    provider: AiCredentialProvider,
  ): Promise<string | null> {
    const record = await this.prisma.organizationAiCredential.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider,
        },
      },
      select: {
        encryptedSecret: true,
      },
    });

    if (!record) {
      return null;
    }

    return this.credentialCryptoService.decrypt(record.encryptedSecret);
  }
}
