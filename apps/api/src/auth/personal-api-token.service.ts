import { createHash, randomBytes } from 'node:crypto';
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PREFIX = 'fxpat_';

@Injectable()
export class PersonalApiTokenService {
  constructor(private readonly prisma: PrismaService) {}

  static hashToken(raw: string) {
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  async createToken(input: { userId: string; organizationId: string; name: string }) {
    const secret = randomBytes(24).toString('hex');
    const token = `${PREFIX}${secret}`;
    const tokenPrefix = token.slice(0, 12);
    const row = await this.prisma.personalApiToken.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        name: input.name.trim() || 'default',
        tokenHash: PersonalApiTokenService.hashToken(token),
        tokenPrefix,
      },
    });
    return {
      id: row.id,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      token,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listTokens(userId: string, organizationId: string) {
    const rows = await this.prisma.personalApiToken.findMany({
      where: { userId, organizationId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async revokeToken(userId: string, organizationId: string, tokenId: string) {
    const existing = await this.prisma.personalApiToken.findFirst({
      where: { id: tokenId, userId, organizationId, revokedAt: null },
    });
    if (!existing) throw new NotFoundException('API token not found.');
    await this.prisma.personalApiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async resolveToken(raw: string) {
    const token = raw.trim();
    if (!token.startsWith(PREFIX)) {
      throw new UnauthorizedException('Invalid API token.');
    }
    const row = await this.prisma.personalApiToken.findFirst({
      where: { tokenHash: PersonalApiTokenService.hashToken(token) },
      include: { user: true, organization: true },
    });
    if (!row || row.revokedAt) {
      throw new UnauthorizedException('Invalid API token.');
    }
    await this.prisma.personalApiToken.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      kind: 'personal_api_token' as const,
      tokenId: row.id,
      user: {
        id: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
        avatarUrl: row.user.avatarUrl,
      },
      organization: {
        id: row.organization.id,
        name: row.organization.name,
        providerOrganizationId: row.organization.providerOrganizationId,
      },
    };
  }
}
