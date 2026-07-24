import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PersonalApiTokenController } from './personal-api-token.controller';

describe('PersonalApiTokenController', () => {
  const authSession = {
    user: { id: 'user-1' },
    organization: { id: 'org-1' },
  };

  it('lists tokens for the authenticated user and organization', async () => {
    const listTokens = vi.fn().mockResolvedValue([{ id: 'pat-1', name: 'laptop' }]);
    const controller = new PersonalApiTokenController({ listTokens } as never);

    await expect(controller.list({ authSession })).resolves.toEqual([
      { id: 'pat-1', name: 'laptop' },
    ]);
    expect(listTokens).toHaveBeenCalledWith('user-1', 'org-1');
  });

  it('creates a token and returns the service result', async () => {
    const createToken = vi.fn().mockResolvedValue({
      id: 'pat-1',
      name: 'laptop',
      token: 'fxpat_abc',
    });
    const controller = new PersonalApiTokenController({ createToken } as never);

    await expect(controller.create({ authSession }, { name: 'laptop' })).resolves.toEqual({
      id: 'pat-1',
      name: 'laptop',
      token: 'fxpat_abc',
    });
    expect(createToken).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'org-1',
      name: 'laptop',
    });
  });

  it('revokes a token by id', async () => {
    const revokeToken = vi.fn().mockResolvedValue({ ok: true });
    const controller = new PersonalApiTokenController({ revokeToken } as never);

    await expect(controller.revoke({ authSession }, 'pat-1')).resolves.toEqual({ ok: true });
    expect(revokeToken).toHaveBeenCalledWith('user-1', 'org-1', 'pat-1');
  });

  it('rejects requests without an organization', () => {
    const controller = new PersonalApiTokenController({
      listTokens: vi.fn(),
    } as never);

    expect(() =>
      controller.list({
        authSession: { user: { id: 'user-1' }, organization: null },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects requests without an authenticated user', () => {
    const controller = new PersonalApiTokenController({
      listTokens: vi.fn(),
    } as never);

    expect(() =>
      controller.list({ authSession: { organization: { id: 'org-1' } } }),
    ).toThrow(UnauthorizedException);
  });
});
