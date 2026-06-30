import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitCredentialsService } from './git-credentials.service';

describe('GitCredentialsService', () => {
  const encrypt = vi.fn();
  const decrypt = vi.fn();
  const findUnique = vi.fn();
  const findMany = vi.fn();
  const upsert = vi.fn();
  const deleteMany = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITLAB_TOKEN;
  });

  function createService() {
    return new GitCredentialsService(
      {
        organizationGitCredential: {
          findUnique,
          findMany,
          upsert,
          deleteMany,
        },
        organization: {
          findMany,
        },
      } as never,
      { encrypt, decrypt } as never,
    );
  }

  it('stores encrypted github token per organization', async () => {
    encrypt.mockReturnValue('encrypted-value');
    upsert.mockResolvedValue({ updatedAt: new Date('2026-06-30T10:00:00.000Z') });

    const service = createService();
    const result = await service.upsertGithubCredential('org-1', 'ghp_testtoken');

    expect(encrypt).toHaveBeenCalledWith('ghp_testtoken');
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      create: { provider: 'github' },
      where: { organizationId_provider: { provider: 'github' } },
    });
    expect(result).toMatchObject({ provider: 'github', configured: true });
  });

  it('returns configured status when gitlab token exists', async () => {
    findUnique.mockResolvedValue({ updatedAt: new Date('2026-06-30T10:00:00.000Z') });
    const service = createService();

    await expect(service.getGitlabCredentialStatus('org-1')).resolves.toEqual({
      provider: 'gitlab',
      configured: true,
      updatedAt: new Date('2026-06-30T10:00:00.000Z').toISOString(),
    });
  });

  it('prefers environment token over organization credential', async () => {
    process.env.GITHUB_TOKEN = 'env-github-token';
    const service = createService();

    await expect(service.getAccessTokenForProvider('github')).resolves.toBe('env-github-token');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('uses singleton organization credential when env is unset', async () => {
    findMany.mockResolvedValueOnce([{ id: 'org-1' }]);
    findUnique.mockResolvedValue({ encryptedSecret: 'encrypted-value' });
    decrypt.mockReturnValue('org-github-token');
    const service = createService();

    await expect(service.getAccessTokenForProvider('github')).resolves.toBe('org-github-token');
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_provider: {
          organizationId: 'org-1',
          provider: 'github',
        },
      },
      select: { encryptedSecret: true },
    });
  });
});
