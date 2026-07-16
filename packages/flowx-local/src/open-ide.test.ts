import { describe, expect, it, vi } from 'vitest';
import { openIde } from './open-ide.js';

describe('openIde', () => {
  it('opens Cursor with the repository path and copies the prompt', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const exec = vi.fn(() => ({ stdin: { end: vi.fn() } }));

    await expect(
      openIde('cursor', '/work/repo', 'Do the work', { spawn, exec, platform: 'darwin' }),
    ).resolves.toEqual({ opened: true, prefilled: false });

    expect(spawn).toHaveBeenCalledWith('cursor', ['/work/repo'], expect.objectContaining({ detached: true }));
    expect(exec).toHaveBeenCalledWith('pbcopy');
  });

  it('opens Codex in the repository working directory', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));

    await expect(
      openIde('codex', '/work/repo', 'Do the work', {
        spawn,
        exec: vi.fn(),
        platform: 'linux',
      }),
    ).resolves.toEqual({ opened: true, prefilled: false });

    expect(spawn).toHaveBeenCalledWith('codex', [], expect.objectContaining({ cwd: '/work/repo' }));
  });

  it('returns opened false when the IDE command cannot spawn', async () => {
    await expect(
      openIde('cursor', '/work/repo', 'Do the work', {
        spawn: vi.fn(() => {
          throw new Error('missing');
        }),
        exec: vi.fn(),
        platform: 'linux',
      }),
    ).resolves.toEqual({ opened: false, prefilled: false });
  });
});
