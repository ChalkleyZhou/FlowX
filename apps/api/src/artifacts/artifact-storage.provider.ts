export const ARTIFACT_STORAGE_PROVIDER = Symbol('ARTIFACT_STORAGE_PROVIDER');

export type StoredArtifactInfo = {
  storageKey: string;
  byteSize: number;
  sha256: string;
};

export interface ArtifactStorageProvider {
  readonly provider: 'local';
  resolvePath(storageKey: string): string;
  write(storageKey: string, content: Buffer): Promise<StoredArtifactInfo>;
  read(storageKey: string): Promise<Buffer>;
  stat(storageKey: string): Promise<{ byteSize: number }>;
}
