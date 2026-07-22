import { describe, expect, it, vi } from 'vitest';
import {
  discoverOpenDesignApp,
  importOpenDesignFolder,
  openOpenDesignWorkspace,
} from './open-design-app.js';

describe('open-design-app', () => {
  it('discovers Open Design.app under /Applications', async () => {
    const access = vi.fn(async (path: string) => {
      if (path === '/Applications/Open Design.app') return;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    await expect(
      discoverOpenDesignApp({
        access,
        candidates: ['/Applications/Open Design.app', '/Other/Open Design.app'],
      }),
    ).resolves.toBe('/Applications/Open Design.app');
  });

  it('opens the desktop app on macOS when no custom command is configured', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const importFolder = vi.fn(async () => ({ imported: false, importError: 'auth' }));

    await expect(
      openOpenDesignWorkspace('/tmp/session-1', {
        openDesignCommand: '',
        platform: 'darwin',
        spawn,
        discoverApp: async () => '/Applications/Open Design.app',
        importFolder,
        skipImport: true,
      }),
    ).resolves.toEqual({
      opened: true,
      imported: false,
    });

    expect(spawn).toHaveBeenCalledWith(
      'open',
      ['-a', '/Applications/Open Design.app'],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
    expect(importFolder).not.toHaveBeenCalled();
  });

  it('falls back to opening the folder when the desktop app is missing', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));

    await expect(
      openOpenDesignWorkspace('/tmp/session-1', {
        openDesignCommand: '',
        platform: 'darwin',
        spawn,
        discoverApp: async () => null,
        importFolder: async () => ({ imported: false }),
      }),
    ).resolves.toMatchObject({ opened: true });

    expect(spawn).toHaveBeenCalledWith(
      'open',
      ['/tmp/session-1'],
      expect.objectContaining({ detached: true }),
    );
  });

  it('uses a configured executable command when provided', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));

    await expect(
      openOpenDesignWorkspace('/tmp/session-1', {
        openDesignCommand: '/usr/local/bin/opendesign',
        platform: 'darwin',
        spawn,
        discoverApp: async () => '/Applications/Open Design.app',
        importFolder: async () => ({ imported: true }),
      }),
    ).resolves.toMatchObject({ opened: true, imported: true });

    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/opendesign',
      ['/tmp/session-1'],
      expect.objectContaining({ detached: true }),
    );
  });

  it('imports a folder through the Open Design daemon CLI when available', async () => {
    const execFile = vi.fn(async (_file: string, args: readonly string[]) => {
      expect(args).toEqual([
        '/app/Contents/Resources/app/prebundled/daemon/daemon-cli.mjs',
        'project',
        'import-folder',
        '/tmp/session-1',
        '--name',
        'session-1',
        '--json',
      ]);
      return {
        stdout: JSON.stringify({ project: { id: 'p1' } }),
        stderr: '',
      };
    });

    await expect(
      importOpenDesignFolder('/tmp/session-1', {
        execFile,
        resolveDaemonCli: async () =>
          '/app/Contents/Resources/app/prebundled/daemon/daemon-cli.mjs',
        resolveSidecarIpcPath: async () => '/tmp/open-design/ipc/release-stable/daemon.sock',
        nodeExecutable: '/usr/bin/node',
      }),
    ).resolves.toEqual({ imported: true });
  });

  it('returns importError instead of throwing when CLI import fails', async () => {
    await expect(
      importOpenDesignFolder('/tmp/session-1', {
        execFile: async () => {
          throw new Error('desktop import token rejected');
        },
        resolveDaemonCli: async () => '/cli.mjs',
        resolveSidecarIpcPath: async () => '/tmp/daemon.sock',
        nodeExecutable: '/usr/bin/node',
      }),
    ).resolves.toEqual({
      imported: false,
      importError: 'desktop import token rejected',
    });
  });
});
