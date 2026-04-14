import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCryptoService } from './credential-crypto.service';

export type CredentialStatusResponse = {
  provider: 'cursor';
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
    const record = await this.prisma.userAiCredential.findUnique({
      where: {
        userId_provider: {
          userId,
          provider: 'cursor',
        },
      },
      select: {
        updatedAt: true,
      },
    });

    if (!record) {
      return { provider: 'cursor', configured: false };
    }

    return {
      provider: 'cursor',
      configured: true,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async upsertCursorCredential(userId: string, apiKey: string): Promise<CredentialStatusResponse> {
    const encryptedSecret = this.credentialCryptoService.encrypt(apiKey);
    const updated = await this.prisma.userAiCredential.upsert({
      where: {
        userId_provider: {
          userId,
          provider: 'cursor',
        },
      },
      create: {
        userId,
        provider: 'cursor',
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

    this.logger.log(`Stored cursor credential for user ${userId}.`);

    return {
      provider: 'cursor',
      configured: true,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteCursorCredential(userId: string): Promise<CredentialStatusResponse> {
    await this.prisma.userAiCredential.deleteMany({
      where: {
        userId,
        provider: 'cursor',
      },
    });

    this.logger.log(`Deleted cursor credential for user ${userId}.`);

    return {
      provider: 'cursor',
      configured: false,
    };
  }

  async getCursorApiKeyForUser(userId: string): Promise<string | null> {
    const record = await this.prisma.userAiCredential.findUnique({
      where: {
        userId_provider: {
          userId,
          provider: 'cursor',
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
