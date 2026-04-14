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

  async getCursorCredentialStatus(userId: string): Promise<CredentialStatusResponse> {
    return this.getCredentialStatus(userId, 'cursor');
  }

  async getCodexCredentialStatus(userId: string): Promise<CredentialStatusResponse> {
    return this.getCredentialStatus(userId, 'codex');
  }

  async upsertCursorCredential(userId: string, apiKey: string): Promise<CredentialStatusResponse> {
    return this.upsertCredential(userId, 'cursor', apiKey);
  }

  async upsertCodexCredential(userId: string, apiKey: string): Promise<CredentialStatusResponse> {
    return this.upsertCredential(userId, 'codex', apiKey);
  }

  async deleteCursorCredential(userId: string): Promise<CredentialStatusResponse> {
    return this.deleteCredential(userId, 'cursor');
  }

  async deleteCodexCredential(userId: string): Promise<CredentialStatusResponse> {
    return this.deleteCredential(userId, 'codex');
  }

  async getCursorApiKeyForUser(userId: string): Promise<string | null> {
    return this.getApiKeyForUser(userId, 'cursor');
  }

  async getCodexApiKeyForUser(userId: string): Promise<string | null> {
    return this.getApiKeyForUser(userId, 'codex');
  }

  private async getCredentialStatus(
    userId: string,
    provider: AiCredentialProvider,
  ): Promise<CredentialStatusResponse> {
    const record = await this.prisma.userAiCredential.findUnique({
      where: {
        userId_provider: {
          userId,
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
    userId: string,
    provider: AiCredentialProvider,
    apiKey: string,
  ): Promise<CredentialStatusResponse> {
    const encryptedSecret = this.credentialCryptoService.encrypt(apiKey);
    const updated = await this.prisma.userAiCredential.upsert({
      where: {
        userId_provider: {
          userId,
          provider,
        },
      },
      create: {
        userId,
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

    this.logger.log(`Stored ${provider} credential for user ${userId}.`);

    return {
      provider,
      configured: true,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private async deleteCredential(
    userId: string,
    provider: AiCredentialProvider,
  ): Promise<CredentialStatusResponse> {
    await this.prisma.userAiCredential.deleteMany({
      where: {
        userId,
        provider,
      },
    });

    this.logger.log(`Deleted ${provider} credential for user ${userId}.`);

    return {
      provider,
      configured: false,
    };
  }

  private async getApiKeyForUser(
    userId: string,
    provider: AiCredentialProvider,
  ): Promise<string | null> {
    const record = await this.prisma.userAiCredential.findUnique({
      where: {
        userId_provider: {
          userId,
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
