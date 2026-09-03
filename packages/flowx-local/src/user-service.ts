import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LAUNCH_AGENT_LABEL = 'ai.flowx.local';
const SYSTEMD_UNIT_NAME = 'flowx-local.service';
const SERVE_LOG_RELATIVE = join('.flowx', 'logs', 'serve.log');

export type RunCommand = (command: string, args: string[]) => void | Promise<void>;

export type InstallUserServiceOptions = {
  platform?: NodeJS.Platform;
  homeDir: string;
  flowxBin: string;
  nodeExecPath?: string;
  run?: RunCommand;
  uid?: number;
};

export type RenderUserServiceInput = {
  nodeExecPath: string;
  flowxBin: string;
  logPath: string;
};

export type InstallUserServiceResult =
  | { skipped: 'win32' }
  | { plistPath: string }
  | { unitPath: string };

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function defaultRun(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status ?? 'unknown'}`);
  }
}

const UNIX_SERVICE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

function servicePathEnv(nodeExecPath: string): string {
  const nodeDir = dirname(nodeExecPath);
  if (
    nodeDir === '/usr/bin' ||
    nodeDir === '/bin' ||
    nodeDir === '/usr/sbin' ||
    nodeDir === '/sbin'
  ) {
    return UNIX_SERVICE_PATH;
  }
  return `${nodeDir}:${UNIX_SERVICE_PATH}`;
}

export function renderLaunchAgentPlist(input: RenderUserServiceInput): string {
  const pathEnv = servicePathEnv(input.nodeExecPath);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LAUNCH_AGENT_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(input.nodeExecPath)}</string>
    <string>${escapeXml(input.flowxBin)}</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(input.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(input.logPath)}</string>
</dict>
</plist>
`;
}

export function renderSystemdUserUnit(input: {
  nodeExecPath: string;
  flowxBin: string;
  logPath?: string;
}): string {
  const pathEnv = servicePathEnv(input.nodeExecPath);
  const lines = [
    '[Unit]',
    'Description=FlowX local loopback daemon',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${input.nodeExecPath} ${input.flowxBin} serve`,
    `Environment=PATH=${pathEnv}`,
    'Restart=always',
  ];
  if (input.logPath) {
    lines.push(`StandardOutput=append:${input.logPath}`, `StandardError=append:${input.logPath}`);
  }
  lines.push('', '[Install]', 'WantedBy=default.target', '');
  return lines.join('\n');
}

function serveLogPath(homeDir: string): string {
  return join(homeDir, SERVE_LOG_RELATIVE);
}

function launchAgentPlistPath(homeDir: string): string {
  return join(homeDir, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
}

function systemdUserUnitPath(homeDir: string): string {
  return join(homeDir, '.config', 'systemd', 'user', SYSTEMD_UNIT_NAME);
}

export function isServiceInstalled(homeDir: string, platform: NodeJS.Platform): boolean {
  if (platform === 'darwin') {
    return existsSync(launchAgentPlistPath(homeDir));
  }
  if (platform === 'linux') {
    return existsSync(systemdUserUnitPath(homeDir));
  }
  return false;
}

function ensureLogDir(homeDir: string): string {
  const logPath = serveLogPath(homeDir);
  mkdirSync(dirname(logPath), { recursive: true });
  return logPath;
}

async function runOrThrow(run: RunCommand, command: string, args: string[]): Promise<void> {
  await run(command, args);
}

export async function installUserService(
  options: InstallUserServiceOptions,
): Promise<InstallUserServiceResult> {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    return { skipped: 'win32' };
  }

  const run = options.run ?? defaultRun;
  const logPath = ensureLogDir(options.homeDir);
  const nodeExecPath = options.nodeExecPath ?? process.execPath;

  if (platform === 'darwin') {
    const plistPath = launchAgentPlistPath(options.homeDir);
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(
      plistPath,
      renderLaunchAgentPlist({
        nodeExecPath,
        flowxBin: options.flowxBin,
        logPath,
      }),
      'utf8',
    );
    const uid = options.uid ?? process.getuid?.() ?? 501;
    const domain = `gui/${uid}`;
    try {
      await runOrThrow(run, 'launchctl', ['bootout', domain, plistPath]);
    } catch {
      // 尚未加载时 bootout 会失败，忽略后继续 bootstrap
    }
    await runOrThrow(run, 'launchctl', ['bootstrap', domain, plistPath]);
    return { plistPath };
  }

  if (platform === 'linux') {
    const unitPath = systemdUserUnitPath(options.homeDir);
    mkdirSync(dirname(unitPath), { recursive: true });
    writeFileSync(
      unitPath,
      renderSystemdUserUnit({
        nodeExecPath,
        flowxBin: options.flowxBin,
        logPath,
      }),
      'utf8',
    );
    await runOrThrow(run, 'systemctl', ['--user', 'daemon-reload']);
    await runOrThrow(run, 'systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT_NAME]);
    return { unitPath };
  }

  throw new Error(`Unsupported platform for user service: ${platform}`);
}
