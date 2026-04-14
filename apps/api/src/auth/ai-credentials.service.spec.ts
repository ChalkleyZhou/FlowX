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
        userAiCredential: {
          findUnique,
          upsert,
          deleteMany,
        },
      } as never,
      { encrypt, decrypt } as never,
    );
  }

  it('stores encrypted cursor key per user', async () => {
    encrypt.mockReturnValue('encrypted-value');
    upsert.mockResolvedValue({ updatedAt: new Date('2026-04-14T11:22:33.000Z') });

    const service = createService();
    const result = await service.upsertCursorCredential('user-1', 'cursor-key');

    expect(encrypt).toHaveBeenCalledWith('cursor-key');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(result.configured).toBe(true);
  });

  it('returns configured status when key exists', async () => {
    findUnique.mockResolvedValue({ updatedAt: new Date('2026-04-14T11:22:33.000Z') });
    const service = createService();

    await expect(service.getCursorCredentialStatus('user-1')).resolves.toEqual({
      provider: 'cursor',
      configured: true,
      updatedAt: new Date('2026-04-14T11:22:33.000Z').toISOString(),
    });
  });

  it('decrypts stored key for runtime injection', async () => {
    findUnique.mockResolvedValue({ encryptedSecret: 'encrypted-value' });
    decrypt.mockReturnValue('decrypted-key');
    const service = createService();

    await expect(service.getCursorApiKeyForUser('user-1')).resolves.toBe('decrypted-key');
    expect(decrypt).toHaveBeenCalledWith('encrypted-value');
  });

  it('deletes user cursor credential', async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    const service = createService();

    await expect(service.deleteCursorCredential('user-1')).resolves.toEqual({
      provider: 'cursor',
      configured: false,
    });
  });
});
