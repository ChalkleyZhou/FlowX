import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCryptoService } from './credential-crypto.service';

export type GitCredentialProvider = 'github' | 'gitlab';

export type GitCredentialStatusResponse = {
  provider: GitCredentialProvider;
  configured: boolean;
  updatedAt?: string;
};

@Injectable()
export class GitCredentialsService {
  private readonly logger = new Logger(GitCredentialsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialCryptoService: CredentialCryptoService,
  ) {}

  async getGithubCredentialStatus(organizationId: string): Promise<GitCredentialStatusResponse> {
    return this.getCredentialStatus(organizationId, 'github');
  }

  async getGitlabCredentialStatus(organizationId: string): Promise<GitCredentialStatusResponse> {
    return this.getCredentialStatus(organizationId, 'gitlab');
  }

  async upsertGithubCredential(
    organizationId: string,
    accessToken: string,
  ): Promise<GitCredentialStatusResponse> {
    return this.upsertCredential(organizationId, 'github', accessToken);
  }

  async upsertGitlabCredential(
    organizationId: string,
    accessToken: string,
  ): Promise<GitCredentialStatusResponse> {
    return this.upsertCredential(organizationId, 'gitlab', accessToken);
  }

  async deleteGithubCredential(organizationId: string): Promise<GitCredentialStatusResponse> {
    return this.deleteCredential(organizationId, 'github');
  }

  async deleteGitlabCredential(organizationId: string): Promise<GitCredentialStatusResponse> {
    return this.deleteCredential(organizationId, 'gitlab');
  }

  async getAccessTokenForProvider(provider: GitCredentialProvider): Promise<string | null> {
    const envToken = this.getEnvAccessToken(provider);
    if (envToken) {
      if (isPlausibleGitAccessToken(provider, envToken)) {
        return envToken;
      }
      this.logger.warn(
        `Ignoring invalid ${provider} token from environment variable; falling back to organization credential.`,
      );
    }

    const organizations = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'asc' },
      take: 2,
      select: { id: true },
    });

    if (organizations.length === 1) {
      return this.getAccessTokenForOrganization(organizations[0]!.id, provider);
    }

    const records = await this.prisma.organizationGitCredential.findMany({
      where: { provider },
      orderBy: { updatedAt: 'desc' },
      take: 1,
      select: {
        encryptedSecret: true,
        organizationId: true,
      },
    });

    if (records.length === 0) {
      return null;
    }

    if (organizations.length > 1) {
      this.logger.warn(
        `Multiple organizations found; using most recently updated ${provider} git credential from organization ${records[0]!.organizationId}.`,
      );
    }

    return this.credentialCryptoService.decrypt(records[0]!.encryptedSecret);
  }

  private getEnvAccessToken(provider: GitCredentialProvider) {
    const envKey = provider === 'github' ? 'GITHUB_TOKEN' : 'GITLAB_TOKEN';
    return process.env[envKey]?.trim() || null;
  }

  private async getAccessTokenForOrganization(
    organizationId: string,
    provider: GitCredentialProvider,
  ): Promise<string | null> {
    const record = await this.prisma.organizationGitCredential.findUnique({
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

  private async getCredentialStatus(
    organizationId: string,
    provider: GitCredentialProvider,
  ): Promise<GitCredentialStatusResponse> {
    const record = await this.prisma.organizationGitCredential.findUnique({
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
    provider: GitCredentialProvider,
    accessToken: string,
  ): Promise<GitCredentialStatusResponse> {
    const trimmedToken = accessToken.trim();
    if (!isPlausibleGitAccessToken(provider, trimmedToken)) {
      throw new BadRequestException(
        provider === 'gitlab'
          ? 'GitLab Access Token 格式不正确，请填写 Personal Access Token（通常以 glpat- 开头）。'
          : 'GitHub Access Token 格式不正确，请填写 Personal Access Token（通常以 ghp_ 或 github_pat_ 开头）。',
      );
    }

    const encryptedSecret = this.credentialCryptoService.encrypt(trimmedToken);
    const updated = await this.prisma.organizationGitCredential.upsert({
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

    this.logger.log(`Stored ${provider} git credential for organization ${organizationId}.`);

    return {
      provider,
      configured: true,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private async deleteCredential(
    organizationId: string,
    provider: GitCredentialProvider,
  ): Promise<GitCredentialStatusResponse> {
    await this.prisma.organizationGitCredential.deleteMany({
      where: {
        organizationId,
        provider,
      },
    });

    this.logger.log(`Deleted ${provider} git credential for organization ${organizationId}.`);

    return {
      provider,
      configured: false,
    };
  }
}

function isPlausibleGitAccessToken(provider: GitCredentialProvider, token: string) {
  const trimmed = token.trim();
  if (trimmed.length < 8 || trimmed.length > 512) {
    return false;
  }
  if (/\s/.test(trimmed)) {
    return false;
  }

  if (provider === 'github') {
    return /^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/.test(trimmed) || /^[A-Za-z0-9_\-]{20,}$/.test(trimmed);
  }

  return /^glpat-/.test(trimmed) || /^[A-Za-z0-9_\-]{20,}$/.test(trimmed);
}
