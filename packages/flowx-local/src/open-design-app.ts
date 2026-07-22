import { access } from 'node:fs/promises';
import { spawn as defaultSpawn, execFile as defaultExecFile } from 'node:child_process';
import { homedir, platform as defaultPlatform } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(defaultExecFile);

export const DEFAULT_OPEN_DESIGN_APP_CANDIDATES = [
  '/Applications/Open Design.app',
  join(homedir(), 'Applications', 'Open Design.app'),
] as const;

export type OpenDesignOpenResult = {
  opened: boolean;
  imported: boolean;
  importError?: string;
};

export type SpawnCommand = (
  command: string,
  args: readonly string[],
  options: { detached: true; stdio: 'ignore'; env?: NodeJS.ProcessEnv },
) => { unref: () => void };

export type ExecFileCommand = (
  file: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

export async function discoverOpenDesignApp(
  options: {
    access?: (path: string) => Promise<void>;
    candidates?: readonly string[];
  } = {},
): Promise<string | null> {
  const check = options.access ?? ((path: string) => access(path).then(() => undefined));
  const candidates = options.candidates ?? DEFAULT_OPEN_DESIGN_APP_CANDIDATES;
  for (const candidate of candidates) {
    try {
      await check(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

async function discoverDaemonCliFromApp(appPath: string): Promise<string | null> {
  const candidates = [
    join(appPath, 'Contents/Resources/app/prebundled/daemon/daemon-cli.mjs'),
    // Launcher payload may host a newer runtime than the outer .app shell.
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  const supportRoot = join(
    homedir(),
    'Library/Application Support/Open Design/launcher/channels/stable/namespaces',
  );
  try {
    const { readdir } = await import('node:fs/promises');
    const namespaces = await readdir(supportRoot);
    for (const namespace of namespaces) {
      const versionsRoot = join(supportRoot, namespace, 'versions');
      let versions: string[] = [];
      try {
        versions = await readdir(versionsRoot);
      } catch {
        continue;
      }
      for (const version of versions.sort().reverse()) {
        const cli = join(
          versionsRoot,
          version,
          'payload/Open Design.app/Contents/Resources/app/prebundled/daemon/daemon-cli.mjs',
        );
        try {
          await access(cli);
          return cli;
        } catch {
          // continue
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function discoverSidecarIpcPath(): Promise<string | null> {
  const base = '/tmp/open-design/ipc';
  const preferred = [
    join(base, 'release-stable', 'daemon.sock'),
    join(base, 'default', 'daemon.sock'),
  ];
  for (const candidate of preferred) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  try {
    const { readdir } = await import('node:fs/promises');
    const namespaces = await readdir(base);
    for (const namespace of namespaces) {
      const sock = join(base, namespace, 'daemon.sock');
      try {
        await access(sock);
        return sock;
      } catch {
        // continue
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export async function importOpenDesignFolder(
  workspacePath: string,
  options: {
    execFile?: ExecFileCommand;
    resolveDaemonCli?: () => Promise<string | null>;
    resolveSidecarIpcPath?: () => Promise<string | null>;
    resolveApp?: () => Promise<string | null>;
    nodeExecutable?: string;
    timeoutMs?: number;
  } = {},
): Promise<{ imported: boolean; importError?: string }> {
  const resolveApp = options.resolveApp ?? (() => discoverOpenDesignApp());
  const resolveDaemonCli =
    options.resolveDaemonCli ??
    (async () => {
      const app = await resolveApp();
      return app ? discoverDaemonCliFromApp(app) : null;
    });
  const resolveIpc = options.resolveSidecarIpcPath ?? discoverSidecarIpcPath;
  const run = options.execFile ?? ((file, args, opts) => execFileAsync(file, [...args], opts));
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const timeoutMs = options.timeoutMs ?? 8_000;

  const cli = await resolveDaemonCli();
  if (!cli) {
    return { imported: false, importError: 'Open Design daemon CLI not found' };
  }

  const ipcPath = await resolveIpc();
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (ipcPath) {
    env.OD_SIDECAR_IPC_PATH = ipcPath;
  }

  const projectName = basename(workspacePath);
  try {
    const { stdout, stderr } = await run(
      nodeExecutable,
      [cli, 'project', 'import-folder', workspacePath, '--name', projectName, '--json'],
      { env, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
    );
    const text = `${stdout}\n${stderr}`.trim();
    if (/\{[\s\S]*"project"/.test(text) || /imported\s+\S+/.test(text)) {
      return { imported: true };
    }
    // CLI may print project id without the word imported when --json
    try {
      const jsonStart = text.indexOf('{');
      if (jsonStart >= 0) {
        const parsed = JSON.parse(text.slice(jsonStart)) as { project?: { id?: string } };
        if (parsed.project?.id) return { imported: true };
      }
    } catch {
      // fall through
    }
    return { imported: false, importError: text || 'import-folder returned no project' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const details =
      error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr.trim()
        : '';
    return {
      imported: false,
      importError: details || message,
    };
  }
}

export async function openOpenDesignWorkspace(
  workspacePath: string,
  options: {
    openDesignCommand?: string;
    platform?: NodeJS.Platform;
    spawn?: SpawnCommand;
    discoverApp?: () => Promise<string | null>;
    importFolder?: typeof importOpenDesignFolder;
    skipImport?: boolean;
  } = {},
): Promise<OpenDesignOpenResult> {
  const runSpawn = options.spawn ?? (defaultSpawn as unknown as SpawnCommand);
  const currentPlatform = options.platform ?? defaultPlatform();
  const discoverApp = options.discoverApp ?? (() => discoverOpenDesignApp());
  const importFolder = options.importFolder ?? importOpenDesignFolder;
  const command = options.openDesignCommand?.trim() ?? '';

  let opened = false;
  try {
    if (command) {
      const child = runSpawn(command, [workspacePath], { detached: true, stdio: 'ignore' });
      child.unref();
      opened = true;
    } else if (currentPlatform === 'darwin') {
      const appPath = await discoverApp();
      const child = appPath
        ? runSpawn('open', ['-a', appPath], { detached: true, stdio: 'ignore' })
        : runSpawn('open', [workspacePath], { detached: true, stdio: 'ignore' });
      child.unref();
      opened = true;
    }
  } catch {
    opened = false;
  }

  const imported =
    options.skipImport === true
      ? { imported: false as const }
      : await importFolder(workspacePath);
  return {
    opened,
    imported: imported.imported,
    ...(imported.importError ? { importError: imported.importError } : {}),
  };
}
