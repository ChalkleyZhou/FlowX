import { exec, spawn } from 'node:child_process';
import { platform as getPlatform } from 'node:os';

export type Ide = 'cursor' | 'codex';

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
};

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

export async function openIde(
  ide: Ide,
  gitRoot: string,
  prompt: string,
  dependencies: OpenIdeDependencies = {},
): Promise<{ opened: boolean; prefilled: boolean }> {
  const run: SpawnCommand = dependencies.spawn ?? spawn;
  try {
    const child =
      ide === 'cursor'
        ? run('cursor', [gitRoot], { detached: true, stdio: 'ignore' })
        : run('codex', [], { cwd: gitRoot, detached: true, stdio: 'ignore' });
    child.unref?.();
    copyToClipboard(
      prompt,
      dependencies.platform ?? getPlatform(),
      dependencies.exec ?? ((command) => exec(command)),
    );
    return { opened: true, prefilled: false };
  } catch {
    return { opened: false, prefilled: false };
  }
}
