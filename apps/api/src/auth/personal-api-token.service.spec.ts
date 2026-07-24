import { createHash, randomBytes } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PersonalApiTokenService } from './personal-api-token.service';

function hashToken(raw: string) {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

describe('PersonalApiTokenService', () => {
  it('creates a token, stores only hash, returns plaintext once', async () => {
    const create = vi.fn().mockImplementation(async ({ data }) => ({
      id: 'pat-1',
      name: data.name,
      tokenPrefix: data.tokenPrefix,
      tokenHash: data.tokenHash,
      userId: data.userId,
      organizationId: data.organizationId,
      createdAt: new Date('2026-07-24T00:00:00.000Z'),
      lastUsedAt: null,
      revokedAt: null,
    }));
    const prisma = { personalApiToken: { create, findMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() } };
    const service = new PersonalApiTokenService(prisma as never);
    const result = await service.createToken({
      userId: 'user-1',
      organizationId: 'org-1',
      name: 'laptop',
    });
    expect(result.token).toMatch(/^fxpat_/);
    expect(result.token.startsWith(result.tokenPrefix)).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tokenHash: hashToken(result.token),
          name: 'laptop',
        }),
      }),
    );
  });

  it('resolves a valid token and rejects revoked', async () => {
    const raw = `fxpat_${randomBytes(24).toString('hex')}`;
    const row = {
      id: 'pat-1',
      tokenHash: hashToken(raw),
      revokedAt: null,
      userId: 'user-1',
      organizationId: 'org-1',
      user: { id: 'user-1', email: null, displayName: 'A', avatarUrl: null },
      organization: { id: 'org-1', name: 'Org', providerOrganizationId: 'p1' },
    };
    const findFirst = vi.fn().mockResolvedValue(row);
    const update = vi.fn().mockResolvedValue(row);
    const prisma = { personalApiToken: { findFirst, update, create: vi.fn(), findMany: vi.fn() } };
    const service = new PersonalApiTokenService(prisma as never);
    const resolved = await service.resolveToken(raw);
    expect(resolved.user.id).toBe('user-1');
    expect(resolved.organization.id).toBe('org-1');

    findFirst.mockResolvedValue({ ...row, revokedAt: new Date() });
    await expect(service.resolveToken(raw)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
