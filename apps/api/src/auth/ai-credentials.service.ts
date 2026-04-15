import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCryptoService } from './credential-crypto.service';

export type AiCredentialProvider = 'cursor' | 'codex';

export type CredentialStatusResponse = {
  provider: AiCredentialProvider;
  configured: boolean;
  updatedAt?: string;
};

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

    return {
      provider,
      configured: false,
    };
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
