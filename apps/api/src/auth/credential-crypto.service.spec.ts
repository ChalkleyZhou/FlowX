import { afterEach, describe, expect, it } from 'vitest';
import { CredentialCryptoService } from './credential-crypto.service';

describe('CredentialCryptoService', () => {
  const originalMasterKey = process.env.FLOWX_CREDENTIAL_MASTER_KEY;

  afterEach(() => {
    if (originalMasterKey === undefined) {
      delete process.env.FLOWX_CREDENTIAL_MASTER_KEY;
      return;
    }
    process.env.FLOWX_CREDENTIAL_MASTER_KEY = originalMasterKey;
  });

  it('encrypts and decrypts cursor api keys', () => {
    process.env.FLOWX_CREDENTIAL_MASTER_KEY = 'development-master-key';
    const service = new CredentialCryptoService();

    const encrypted = service.encrypt('cursor-user-secret');
    const decrypted = service.decrypt(encrypted);

    expect(encrypted).not.toContain('cursor-user-secret');
    expect(decrypted).toBe('cursor-user-secret');
  });

  it('uses randomized iv so ciphertext differs each time', () => {
    process.env.FLOWX_CREDENTIAL_MASTER_KEY = 'development-master-key';
    const service = new CredentialCryptoService();

    const first = service.encrypt('same-secret');
    const second = service.encrypt('same-secret');

    expect(first).not.toBe(second);
  });

  it('throws if master key is missing', () => {
    delete process.env.FLOWX_CREDENTIAL_MASTER_KEY;
    const service = new CredentialCryptoService();
    expect(() => service.encrypt('secret')).toThrow(/FLOWX_CREDENTIAL_MASTER_KEY/);
  });
});
