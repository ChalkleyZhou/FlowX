import { BadRequestException, Injectable } from '@nestjs/common';
import OSS from 'ali-oss';
import { createHash } from 'node:crypto';
import type { ArtifactStorageProvider, StoredArtifactInfo } from './artifact-storage.provider';

type OssClient = Pick<OSS, 'put' | 'get' | 'head'>;

export type OssArtifactStorageOptions = {
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
  endpoint?: string;
  prefix?: string;
};

@Injectable()
export class OssArtifactStorageProvider implements ArtifactStorageProvider {
  readonly provider = 'oss' as const;
  private readonly client: OssClient;
  private readonly prefix: string;

  constructor(options: OssArtifactStorageOptions = {}, client?: OssClient) {
    const config = {
      region: options.region?.trim() || process.env.FLOWX_OSS_REGION?.trim(),
      bucket: options.bucket?.trim() || process.env.FLOWX_OSS_BUCKET?.trim(),
      accessKeyId: options.accessKeyId?.trim() || process.env.FLOWX_OSS_ACCESS_KEY_ID?.trim(),
      accessKeySecret: options.accessKeySecret?.trim() || process.env.FLOWX_OSS_ACCESS_KEY_SECRET?.trim(),
      endpoint: options.endpoint?.trim() || process.env.FLOWX_OSS_ENDPOINT?.trim(),
    };
    const missing = Object.entries(config)
      .filter(([key, value]) => key !== 'endpoint' && !value)
      .map(([key]) => key);
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'OSS_STORAGE_CONFIG_INVALID',
        message: `OSS storage requires: ${missing.join(', ')}.`,
      });
    }

    this.prefix = normalizePrefix(options.prefix ?? process.env.FLOWX_OSS_PREFIX);
    this.client = client ?? new OSS({
      ...config,
      region: config.region!,
      bucket: config.bucket!,
      accessKeyId: config.accessKeyId!,
      accessKeySecret: config.accessKeySecret!,
    });
  }

  async write(storageKey: string, content: Buffer): Promise<StoredArtifactInfo> {
    const key = this.toObjectKey(storageKey);
    try {
      await this.client.put(key, content);
    } catch {
      throw new Error('OSS object storage write failed.');
    }
    return {
      storageKey,
      byteSize: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  }

  async read(storageKey: string): Promise<Buffer> {
    try {
      const result = await this.client.get(this.toObjectKey(storageKey));
      const content = result.content;
      if (Buffer.isBuffer(content)) return content;
      if (content instanceof Uint8Array) return Buffer.from(content);
      if (content == null) throw new Error('empty response');
      return Buffer.from(content);
    } catch {
      throw new Error('OSS object storage read failed.');
    }
  }

  async stat(storageKey: string): Promise<{ byteSize: number }> {
    try {
      const result = await this.client.head(this.toObjectKey(storageKey));
      const value = result.res?.headers?.['content-length'] ?? result.res?.headers?.['Content-Length'];
      const byteSize = Number(value);
      if (!Number.isFinite(byteSize) || byteSize < 0) throw new Error('invalid content length');
      return { byteSize };
    } catch {
      throw new Error('OSS object storage stat failed.');
    }
  }

  toObjectKey(storageKey: string): string {
    const normalized = storageKey.trim().replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
      throw new BadRequestException({ code: 'ARTIFACT_INVALID_REFERENCE', message: 'Invalid OSS artifact storage key.' });
    }
    if (normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new BadRequestException({ code: 'ARTIFACT_INVALID_REFERENCE', message: 'Invalid OSS artifact storage key.' });
    }
    return this.prefix ? `${this.prefix}/${normalized}` : normalized;
  }
}

function normalizePrefix(value: string | undefined): string {
  return (value ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
