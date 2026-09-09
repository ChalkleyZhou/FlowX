import { exec, spawn } from 'node:child_process';
import { existsSync as defaultExistsSync } from 'node:fs';
import { platform as getPlatform } from 'node:os';
import { win32 as win32Path } from 'node:path';

export const LOCAL_IDES = ['cursor', 'codex', 'workbuddy'] as const;
export type Ide = (typeof LOCAL_IDES)[number];

export function isLocalIde(value: string): value is Ide {
  return (LOCAL_IDES as readonly string[]).includes(value);
}

type SpawnCommand = (
  command: string,
  args: string[],
  options: { cwd?: string; detached: boolean; stdio: 'ignore' },
) => { unref?: () => void };

type ExecuteCommand = (
  command: string,
) => { stdin?: { end: (input: string) => void } | null } | undefined;

export type OpenIdeDependencies = {
  spawn?: SpawnCommand;
  exec?: ExecuteCommand;
  platform?: NodeJS.Platform;
  existsSync?: (path: string) => boolean;
  env?: NodeJS.ProcessEnv;
};

export function resolveWorkBuddyExecutable(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
  existsSync: (path: string) => boolean = defaultExistsSync,
): string | null {
  if (platform !== 'win32') {
    return null;
  }
  const configured = env.WORKBUDDY_PATH?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  const localAppData = env.LOCALAPPDATA?.trim();
  if (!localAppData) {
    return null;
  }
  const fallback = win32Path.join(localAppData, 'Programs', 'WorkBuddy', 'WorkBuddy.exe');
  return existsSync(fallback) ? fallback : null;
}

function copyToClipboard(
  prompt: string,
  platform: NodeJS.Platform,
  run: ExecuteCommand,
): void {
  if (platform !== 'darwin') {
    return;
  }
  try {
    const child = run('pbcopy');
    child?.stdin?.end(prompt);
  } catch {
    // Clipboard support is best effort.
  }
}

function resolveLaunchCommand(
  ide: Ide,
  gitRoot: string,
  platform: NodeJS.Platform,
  deps: OpenIdeDependencies,
): { command: string; args: string[]; cwd?: string } | null {
  if (ide === 'cursor') {
    return { command: 'cursor', args: [gitRoot] };
  }
  if (ide === 'codex') {
    return { command: 'codex', args: [], cwd: gitRoot };
  }
  if (platform === 'darwin') {
    return { command: 'open', args: ['-a', 'WorkBuddy', gitRoot] };
  }
  if (platform === 'win32') {
    const exe = resolveWorkBuddyExecutable(
      platform,
      deps.env ?? process.env,
      deps.existsSync ?? defaultExistsSync,
    );
    if (!exe) {
      return null;
    }
    return { command: exe, args: [gitRoot] };
  }
  return null;
}

export async function openIde(
  ide: Ide,
  gitRoot: string,
  prompt: string,
  dependencies: OpenIdeDependencies = {},
): Promise<{ opened: boolean; prefilled: boolean }> {
  const platform = dependencies.platform ?? getPlatform();
  const launch = resolveLaunchCommand(ide, gitRoot, platform, dependencies);
  if (!launch) {
    return { opened: false, prefilled: false };
  }
  const run: SpawnCommand = dependencies.spawn ?? spawn;
  try {
    const child = run(launch.command, launch.args, {
      cwd: launch.cwd,
      detached: true,
      stdio: 'ignore',
    });
    child.unref?.();
    copyToClipboard(prompt, platform, dependencies.exec ?? ((command) => exec(command)));
    return { opened: true, prefilled: false };
  } catch {
    return { opened: false, prefilled: false };
  }
}
