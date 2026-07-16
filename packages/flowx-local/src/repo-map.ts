import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { loadConfig, normalizeRepoUrl, saveConfig, type LocalConfig } from './config.js';

export type PathCancelledError = Error & { code: 'PATH_CANCELLED' };

export type RepoMapDependencies = {
  loadConfig?: () => LocalConfig;
  saveConfig?: (config: LocalConfig) => void;
  selectDirectory?: (repoUrl: string) => Promise<string | null>;
};

export async function selectDirectoryAtRuntime(repoUrl: string): Promise<string | null> {
  if (platform() !== 'darwin') {
    throw new Error(
      `No directory picker is available on this platform. Run flowx-local map ${repoUrl} <path>.`,
    );
  }

  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', 'POSIX path of (choose folder with prompt "Select local repository folder")'],
      (error, stdout) => {
        if (error) {
          if ((error as { code?: number }).code === 1) {
            resolve(null);
            return;
          }
          reject(error);
          return;
        }
        resolve(stdout.trim() || null);
      },
    );
  });
}

export async function resolveRepoPath(
  repoUrl: string,
  dependencies: RepoMapDependencies = {},
): Promise<string> {
  const normalizedUrl = normalizeRepoUrl(repoUrl);
  const config = (dependencies.loadConfig ?? loadConfig)();
  const mappedPath = config.repositories[normalizedUrl];
  if (mappedPath) {
    return mappedPath;
  }

  const selectedPath = await (dependencies.selectDirectory ?? selectDirectoryAtRuntime)(normalizedUrl);
  if (selectedPath) {
    (dependencies.saveConfig ?? saveConfig)({
      ...config,
      repositories: { ...config.repositories, [normalizedUrl]: selectedPath },
    });
    return selectedPath;
  }

  const error = new Error('PATH_CANCELLED') as PathCancelledError;
  error.code = 'PATH_CANCELLED';
  throw error;
}
