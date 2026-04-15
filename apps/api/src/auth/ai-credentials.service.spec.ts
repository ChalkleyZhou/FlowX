import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiCredentialsService } from './ai-credentials.service';

describe('AiCredentialsService', () => {
  const encrypt = vi.fn();
  const decrypt = vi.fn();
  const findUnique = vi.fn();
  const upsert = vi.fn();
  const deleteMany = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createService() {
    return new AiCredentialsService(
      {
        organizationAiCredential: {
          findUnique,
          upsert,
          deleteMany,
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
});
