import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOCAL_CONFIG, type LocalConfig } from './config.js';
import { resolveRepoPath } from './repo-map.js';

const config: LocalConfig = {
  ...DEFAULT_LOCAL_CONFIG,
  port: 3920,
  repositories: { 'https://github.com/org/repo': '/work/repo' },
  defaultIde: 'cursor',
};

describe('resolveRepoPath', () => {
  it('returns an existing normalized repository mapping', async () => {
    const selectDirectory = vi.fn();

    await expect(
      resolveRepoPath('https://github.com/org/repo.git', {
        loadConfig: () => config,
        saveConfig: vi.fn(),
        selectDirectory,
      }),
    ).resolves.toBe('/work/repo');
    expect(selectDirectory).not.toHaveBeenCalled();
  });

  it('selects and persists an unmapped repository path', async () => {
    const saveConfig = vi.fn();

    await expect(
      resolveRepoPath('https://github.com/org/other.git', {
        loadConfig: () => ({ ...config, repositories: {} }),
        saveConfig,
        selectDirectory: async () => '/work/other',
      }),
    ).resolves.toBe('/work/other');
    expect(saveConfig).toHaveBeenCalledWith({
      ...config,
      repositories: { 'https://github.com/org/other': '/work/other' },
    });
  });

  it('throws PATH_CANCELLED when directory selection is cancelled', async () => {
    await expect(
      resolveRepoPath('https://github.com/org/other', {
        loadConfig: () => ({ ...config, repositories: {} }),
        saveConfig: vi.fn(),
        selectDirectory: async () => null,
      }),
    ).rejects.toMatchObject({ code: 'PATH_CANCELLED' });
  });
});
