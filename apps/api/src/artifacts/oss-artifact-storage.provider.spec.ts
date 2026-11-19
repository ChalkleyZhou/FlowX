import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OssArtifactStorageProvider } from './oss-artifact-storage.provider';

function client() {
  return {
    put: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({ content: Buffer.from('hello') }),
    head: vi.fn().mockResolvedValue({ res: { headers: { 'content-length': '5' } } }),
  };
}

const options = {
  region: 'oss-cn-hangzhou',
  bucket: 'flowx-test',
  accessKeyId: 'test-id',
  accessKeySecret: 'test-secret',
  prefix: '/flowx/test/',
};

describe('OssArtifactStorageProvider', () => {
  it('requires all OSS credentials except optional endpoint', () => {
    expect(() => new OssArtifactStorageProvider({}, client())).toThrow(BadRequestException);
  });

  it('writes with a normalized prefixed key and returns digest metadata', async () => {
    const mocked = client();
    const provider = new OssArtifactStorageProvider(options, mocked);

    await expect(provider.write('managed/session/report.txt', Buffer.from('hello'))).resolves.toMatchObject({
      storageKey: 'managed/session/report.txt',
      byteSize: 5,
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    });
    expect(mocked.put).toHaveBeenCalledWith('flowx/test/managed/session/report.txt', Buffer.from('hello'));
  });

  it('reads and stats objects through the SDK', async () => {
    const mocked = client();
    const provider = new OssArtifactStorageProvider(options, mocked);

    await expect(provider.read('managed/session/report.txt')).resolves.toEqual(Buffer.from('hello'));
    await expect(provider.stat('managed/session/report.txt')).resolves.toEqual({ byteSize: 5 });
    expect(mocked.get).toHaveBeenCalledWith('flowx/test/managed/session/report.txt');
    expect(mocked.head).toHaveBeenCalledWith('flowx/test/managed/session/report.txt');
  });

  it('rejects traversal keys and hides SDK errors', async () => {
    const mocked = client();
    mocked.put.mockRejectedValue(new Error('secret endpoint details'));
    const provider = new OssArtifactStorageProvider(options, mocked);

    expect(() => provider.toObjectKey('../secret')).toThrow(BadRequestException);
    await expect(provider.write('managed/report.txt', Buffer.from('x'))).rejects.toThrow(
      'OSS object storage write failed.',
    );
  });
});
