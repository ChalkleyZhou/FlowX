import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ArtifactStorageProvider, StoredArtifactInfo } from './artifact-storage.provider';

@Injectable()
export class LocalArtifactStorageProvider implements ArtifactStorageProvider {
  readonly provider = 'local' as const;

  resolvePath(storageKey: string): string {
    const normalized = storageKey.trim().replace(/\\/g, '/');
    if (!normalized || isAbsolute(normalized) || normalized.includes('\0')) {
      throw this.invalidStorageKey();
    }

    const [namespace, ...segments] = normalized.split('/');
    if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw this.invalidStorageKey();
    }

    const root = this.resolveNamespaceRoot(namespace);
    const absolutePath = resolve(root, ...segments);
    const relativePath = relative(root, absolutePath);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw this.invalidStorageKey();
    }
    return absolutePath;
  }

  async write(storageKey: string, content: Buffer): Promise<StoredArtifactInfo> {
    const absolutePath = this.resolvePath(storageKey);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
    return {
      storageKey,
      byteSize: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    };
  }

  read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolvePath(storageKey));
  }

  async stat(storageKey: string): Promise<{ byteSize: number }> {
    const file = await stat(this.resolvePath(storageKey));
    return { byteSize: file.size };
  }

  private resolveNamespaceRoot(namespace: string): string {
    switch (namespace) {
      case 'managed':
        return resolve(
          process.env.FLOWX_ARTIFACT_STORE_ROOT?.trim() ||
            join(process.cwd(), '.flowx-data', 'artifacts'),
        );
      case 'workflow':
        return resolve(
          process.env.FLOWX_ARTIFACTS_ROOT?.trim() ||
            join(process.cwd(), '.flowx-data', 'workflows'),
        );
      case 'design':
        return resolve(
          process.env.FLOWX_DESIGN_ARTIFACTS_ROOT?.trim() ||
            join(process.cwd(), '.flowx-data', 'design-artifacts'),
        );
      default:
        throw this.invalidStorageKey();
    }
  }

  private invalidStorageKey() {
    return new BadRequestException({
      code: 'ARTIFACT_INVALID_REFERENCE',
      message: 'Invalid local artifact storage key.',
    });
  }
}
