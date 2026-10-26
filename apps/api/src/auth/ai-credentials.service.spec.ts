import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiCredentialsService } from './ai-credentials.service';

describe('AiCredentialsService', () => {
  const encrypt = vi.fn();
  const decrypt = vi.fn();
  const findUnique = vi.fn();
  const findMany = vi.fn();
  const upsert = vi.fn();
  const deleteMany = vi.fn();
  const organizationFindUnique = vi.fn();
  const organizationUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
    organizationFindUnique.mockResolvedValue({ preferredAiProvider: null });
    organizationUpdate.mockResolvedValue({});
  });

  function createService() {
    return new AiCredentialsService(
      {
        organizationAiCredential: {
          findUnique,
          findMany,
          upsert,
          deleteMany,
        },
        organization: {
          findUnique: organizationFindUnique,
          update: organizationUpdate,
        },
      } as never,
      { encrypt, decrypt } as never,
    );
  }

  it('stores encrypted cursor key per organization', async () => {
    encrypt.mockReturnValue('encrypted-value');
    upsert.mockResolvedValue({ updatedAt: new Date('2026-04-14T11:22:33.000Z') });

    const service = createService();
    const result = await service.upsertCursorCredential('org-1', 'cursor-key');

    expect(encrypt).toHaveBeenCalledWith('cursor-key');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      create: { provider: 'cursor' },
      where: { organizationId_provider: { provider: 'cursor' } },
    });
    expect(result.configured).toBe(true);
  });

  it('stores encrypted codex key per organization', async () => {
    encrypt.mockReturnValue('encrypted-value');
    upsert.mockResolvedValue({ updatedAt: new Date('2026-04-14T11:22:33.000Z') });

    const service = createService();
    const result = await service.upsertCodexCredential('org-1', 'codex-key');

    expect(encrypt).toHaveBeenCalledWith('codex-key');
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      create: { provider: 'codex' },
      where: { organizationId_provider: { provider: 'codex' } },
    });
    expect(result).toMatchObject({ provider: 'codex', configured: true });
  });

  it('returns configured status when key exists', async () => {
    findUnique.mockResolvedValue({ updatedAt: new Date('2026-04-14T11:22:33.000Z') });
    const service = createService();

    await expect(service.getCursorCredentialStatus('org-1')).resolves.toEqual({
      provider: 'cursor',
      configured: true,
      updatedAt: new Date('2026-04-14T11:22:33.000Z').toISOString(),
    });
  });

  it('decrypts stored key for runtime injection', async () => {
    findUnique.mockResolvedValue({ encryptedSecret: 'encrypted-value' });
    decrypt.mockReturnValue('decrypted-key');
    const service = createService();

    await expect(service.getCursorApiKeyForOrganization('org-1')).resolves.toBe('decrypted-key');
    expect(decrypt).toHaveBeenCalledWith('encrypted-value');
  });

  it('decrypts stored codex key for runtime injection', async () => {
    findUnique.mockResolvedValue({ encryptedSecret: 'encrypted-value' });
    decrypt.mockReturnValue('decrypted-codex-key');
    const service = createService();

    await expect(service.getCodexApiKeyForOrganization('org-1')).resolves.toBe('decrypted-codex-key');
    expect(findUnique.mock.calls[0]?.[0]).toMatchObject({
      where: { organizationId_provider: { provider: 'codex' } },
    });
  });

  it('deletes organization cursor credential', async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    const service = createService();

    await expect(service.deleteCursorCredential('org-1')).resolves.toEqual({
      provider: 'cursor',
      configured: false,
    });
  });

  it('uses the first saved credential as the online preference', async () => {
    encrypt.mockReturnValue('encrypted-value');
    upsert.mockResolvedValue({ updatedAt: new Date('2026-04-14T11:22:33.000Z') });
    findMany.mockResolvedValue([{ provider: 'cursor' }]);
    const service = createService();

    await service.upsertCursorCredential('org-1', 'cursor-key');

    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { preferredAiProvider: 'cursor' },
    });
  });

  it('keeps the existing preference when another credential is added', async () => {
    encrypt.mockReturnValue('encrypted-value');
    upsert.mockResolvedValue({ updatedAt: new Date('2026-04-14T11:22:33.000Z') });
    findMany.mockResolvedValue([{ provider: 'cursor' }, { provider: 'codex' }]);
    organizationFindUnique.mockResolvedValue({ preferredAiProvider: 'cursor' });
    const service = createService();

    await service.upsertCodexCredential('org-1', 'codex-key');

    expect(organizationUpdate).not.toHaveBeenCalled();
  });

  it('moves the preference to the remaining credential after the preferred one is deleted', async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    findMany.mockResolvedValue([{ provider: 'codex' }]);
    organizationFindUnique.mockResolvedValue({ preferredAiProvider: 'cursor' });
    const service = createService();

    await service.deleteCursorCredential('org-1');

    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { preferredAiProvider: 'codex' },
    });
  });

  it('reports online AI unavailable when the organization has no credentials', async () => {
    const service = createService();

    await expect(service.getOnlineAiPolicy('org-1')).resolves.toEqual({
      preferredProvider: null,
      defaultProvider: null,
      onlineAvailable: false,
      providers: [
        { id: 'cursor', label: 'Cursor CLI', configured: false },
        { id: 'codex', label: 'Codex', configured: false },
      ],
    });
  });

  it('rejects a preference for a provider that is not configured', async () => {
    const service = createService();

    await expect(service.setPreferredProvider('org-1', 'cursor')).rejects.toThrow(/未配置 Cursor CLI/);
    expect(organizationUpdate).not.toHaveBeenCalled();
  });

  it('stores an explicit preference among configured providers', async () => {
    findMany.mockResolvedValue([
      { provider: 'cursor', updatedAt: new Date('2026-04-14T11:22:33.000Z') },
      { provider: 'codex', updatedAt: new Date('2026-04-15T11:22:33.000Z') },
    ]);
    organizationFindUnique
      .mockResolvedValueOnce({ preferredAiProvider: 'codex' })
      .mockResolvedValueOnce({ preferredAiProvider: 'cursor' });
    const service = createService();

    const policy = await service.setPreferredProvider('org-1', 'cursor');

    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { preferredAiProvider: 'cursor' },
    });
    expect(policy).toMatchObject({
      preferredProvider: 'cursor',
      defaultProvider: 'cursor',
      onlineAvailable: true,
    });
  });
});
