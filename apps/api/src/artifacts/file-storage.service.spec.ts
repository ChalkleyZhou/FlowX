import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { FileStorageService } from './file-storage.service';

const previousProvider = process.env.FLOWX_FILE_STORAGE_PROVIDER;

afterEach(() => {
  if (previousProvider === undefined) delete process.env.FLOWX_FILE_STORAGE_PROVIDER;
  else process.env.FLOWX_FILE_STORAGE_PROVIDER = previousProvider;
});

const local = { provider: 'local' as const, resolvePath: () => '/safe/file', write: async () => ({ storageKey: 'x', byteSize: 1, sha256: 'x' }), read: async () => Buffer.from('x'), stat: async () => ({ byteSize: 1 }) };
const oss = { provider: 'oss' as const, toObjectKey: () => 'prefix/x', write: async () => ({ storageKey: 'x', byteSize: 1, sha256: 'x' }), read: async () => Buffer.from('x'), stat: async () => ({ byteSize: 1 }) };

describe('FileStorageService', () => {
  it('defaults to local and routes both providers', () => {
    delete process.env.FLOWX_FILE_STORAGE_PROVIDER;
    const service = new FileStorageService(local, oss);
    expect(service.defaultProviderName).toBe('local');
    expect(service.providerFor('oss')).toBe(oss);
    expect(service.providerFor('local')).toBe(local);
  });

  it('selects oss as the default provider', () => {
    process.env.FLOWX_FILE_STORAGE_PROVIDER = 'oss';
    const service = new FileStorageService(local, oss);
    expect(service.defaultProviderName).toBe('oss');
    expect(service.defaultProvider()).toBe(oss);
  });

  it('rejects unsupported provider names', () => {
    const service = new FileStorageService(local, oss);
    expect(() => service.providerFor('s3')).toThrow(BadRequestException);
  });
});
