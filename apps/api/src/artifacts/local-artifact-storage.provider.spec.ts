import { BadRequestException } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalArtifactStorageProvider } from './local-artifact-storage.provider';

describe('LocalArtifactStorageProvider', () => {
  let root: string;
  let originalRoot: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'flowx-artifacts-'));
    originalRoot = process.env.FLOWX_ARTIFACT_STORE_ROOT;
    process.env.FLOWX_ARTIFACT_STORE_ROOT = root;
  });

  afterEach(async () => {
    if (originalRoot === undefined) {
      delete process.env.FLOWX_ARTIFACT_STORE_ROOT;
    } else {
      process.env.FLOWX_ARTIFACT_STORE_ROOT = originalRoot;
    }
    await rm(root, { recursive: true, force: true });
  });

  it('rejects path traversal and absolute storage keys', () => {
    const provider = new LocalArtifactStorageProvider();

    expect(() => provider.resolvePath('../secret.txt')).toThrow(BadRequestException);
    expect(() => provider.resolvePath('/tmp/secret.txt')).toThrow(BadRequestException);
    expect(() => provider.resolvePath('managed/../../secret.txt')).toThrow(BadRequestException);
  });

  it('writes and reads a managed artifact separately from metadata registration', async () => {
    const provider = new LocalArtifactStorageProvider();
    const content = Buffer.from('artifact-content');

    const stored = await provider.write('managed/session-1/report.txt', content);

    expect(stored.byteSize).toBe(content.byteLength);
    expect(await provider.read('managed/session-1/report.txt')).toEqual(content);
    expect(await readFile(join(root, 'session-1', 'report.txt'))).toEqual(content);
  });
});
