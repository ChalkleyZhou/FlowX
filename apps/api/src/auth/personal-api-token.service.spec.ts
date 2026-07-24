import { createHash, randomBytes } from 'node:crypto';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
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

  it('lists only active tokens for the user and organization', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'pat-1',
        name: 'laptop',
        tokenPrefix: 'fxpat_abcdef',
        createdAt: new Date('2026-07-24T00:00:00.000Z'),
        lastUsedAt: null,
      },
    ]);
    const prisma = { personalApiToken: { findMany, create: vi.fn(), update: vi.fn(), findFirst: vi.fn() } };
    const service = new PersonalApiTokenService(prisma as never);

    await expect(service.listTokens('user-1', 'org-1')).resolves.toEqual([
      {
        id: 'pat-1',
        name: 'laptop',
        tokenPrefix: 'fxpat_abcdef',
        createdAt: '2026-07-24T00:00:00.000Z',
        lastUsedAt: null,
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', organizationId: 'org-1', revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('revokes an active token and rejects missing ones', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'pat-1' });
    const update = vi.fn().mockResolvedValue({ id: 'pat-1' });
    const prisma = { personalApiToken: { findFirst, update, create: vi.fn(), findMany: vi.fn() } };
    const service = new PersonalApiTokenService(prisma as never);

    await expect(service.revokeToken('user-1', 'org-1', 'pat-1')).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pat-1' },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );

    findFirst.mockResolvedValue(null);
    await expect(service.revokeToken('user-1', 'org-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
