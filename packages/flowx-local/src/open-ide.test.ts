import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { openIde } from './open-ide.js';

describe('openIde', () => {
  it('opens the Cursor macOS app with the repository path and copies the prompt', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const exec = vi.fn(() => ({ stdin: { end: vi.fn() } }));

    await expect(
      openIde('cursor', '/work/repo', 'Do the work', { spawn, exec, platform: 'darwin' }),
    ).resolves.toEqual({ opened: true, prefilled: false });

    expect(spawn).toHaveBeenCalledWith('open', ['-a', 'Cursor', '/work/repo'], expect.objectContaining({ detached: true }));
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

  it('keeps the daemon alive when an IDE process emits an async spawn error', async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    await openIde('cursor', '/work/repo', 'Do the work', {
      spawn: vi.fn(() => child), exec: vi.fn(), platform: 'linux',
    });

    expect(() => child.emit('error', Object.assign(new Error('missing cursor'), { code: 'ENOENT' }))).not.toThrow();
  });

  it('opens WorkBuddy on macOS with open -a', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const exec = vi.fn(() => ({ stdin: { end: vi.fn() } }));

    await expect(
      openIde('workbuddy', '/work/repo', 'Do the work', { spawn, exec, platform: 'darwin' }),
    ).resolves.toEqual({ opened: true, prefilled: false });

    expect(spawn).toHaveBeenCalledWith(
      'open',
      ['-a', 'WorkBuddy', '/work/repo'],
      expect.objectContaining({ detached: true }),
    );
    expect(exec).toHaveBeenCalledWith('pbcopy');
  });

  it('opens WorkBuddy.exe on Windows from WORKBUDDY_PATH', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const existsSync = vi.fn(() => true);

    await expect(
      openIde('workbuddy', 'C:\\work\\repo', 'Do the work', {
        spawn,
        exec: vi.fn(),
        platform: 'win32',
        existsSync,
        env: { WORKBUDDY_PATH: 'D:\\Apps\\WorkBuddy.exe' },
      }),
    ).resolves.toEqual({ opened: true, prefilled: false });

    expect(spawn).toHaveBeenCalledWith(
      'D:\\Apps\\WorkBuddy.exe',
      ['C:\\work\\repo'],
      expect.objectContaining({ detached: true }),
    );
  });

  it('opens WorkBuddy.exe from LOCALAPPDATA when WORKBUDDY_PATH is absent', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const existsSync = vi.fn((path: string) => path.endsWith('WorkBuddy.exe'));

    await expect(
      openIde('workbuddy', 'C:\\work\\repo', 'prompt', {
        spawn,
        exec: vi.fn(),
        platform: 'win32',
        existsSync,
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      }),
    ).resolves.toEqual({ opened: true, prefilled: false });

    expect(spawn).toHaveBeenCalledWith(
      'C:\\Users\\me\\AppData\\Local\\Programs\\WorkBuddy\\WorkBuddy.exe',
      ['C:\\work\\repo'],
      expect.objectContaining({ detached: true }),
    );
  });

  it('does not spawn WorkBuddy on Linux', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));

    await expect(
      openIde('workbuddy', '/work/repo', 'Do the work', {
        spawn,
        exec: vi.fn(),
        platform: 'linux',
      }),
    ).resolves.toEqual({ opened: false, prefilled: false });

    expect(spawn).not.toHaveBeenCalled();
  });

  it('returns opened false when Windows WorkBuddy.exe is missing', async () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));

    await expect(
      openIde('workbuddy', 'C:\\work\\repo', 'prompt', {
        spawn,
        exec: vi.fn(),
        platform: 'win32',
        existsSync: () => false,
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      }),
    ).resolves.toEqual({ opened: false, prefilled: false });

    expect(spawn).not.toHaveBeenCalled();
  });
});
