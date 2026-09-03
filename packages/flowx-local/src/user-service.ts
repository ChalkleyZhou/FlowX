import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';

const LAUNCH_AGENT_LABEL = 'ai.flowx.local';
const SYSTEMD_UNIT_NAME = 'flowx-local.service';
const WINDOWS_TASK_NAME = 'ai.flowx.local';
const SERVE_LOG_RELATIVE = join('.flowx', 'logs', 'serve.log');

export type RunCommand = (command: string, args: string[]) => void | Promise<void>;

export type InstallUserServiceOptions = {
  platform?: NodeJS.Platform;
  homeDir: string;
  flowxBin: string;
  nodeExecPath?: string;
  run?: RunCommand;
  uid?: number;
  windowsUser?: string;
};

export type RenderUserServiceInput = {
  nodeExecPath: string;
  flowxBin: string;
  logPath: string;
};

export type InstallUserServiceResult =
  | { plistPath: string }
  | { unitPath: string }
  | { taskXmlPath: string };

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

export function resolveNodeServeEntry(flowxBin: string): string {
  if (/\.(cjs|mjs|js)$/i.test(flowxBin)) {
    return flowxBin;
  }
  const sibling = join(dirname(flowxBin), 'node_modules', '@flowx-ai', 'local', 'dist', 'index.js');
  if (existsSync(sibling)) {
    return sibling;
  }
  throw new Error(
    `Could not resolve flowx-local JS entry from ${flowxBin}. Re-run npm install -g @flowx-ai/local.`,
  );
}

export function renderScheduledTaskXml(input: RenderUserServiceInput & { userId: string }): string {
  const serveEntry = resolveNodeServeEntry(input.flowxBin);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\\${escapeXml(WINDOWS_TASK_NAME)}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${escapeXml(input.userId)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(input.nodeExecPath)}</Command>
      <Arguments>"${escapeXml(serveEntry)}" serve</Arguments>
    </Exec>
  </Actions>
</Task>
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

function scheduledTaskXmlPath(homeDir: string): string {
  return join(homeDir, '.flowx', `${WINDOWS_TASK_NAME}.xml`);
}

export function isServiceInstalled(homeDir: string, platform: NodeJS.Platform): boolean {
  if (platform === 'darwin') {
    return existsSync(launchAgentPlistPath(homeDir));
  }
  if (platform === 'linux') {
    return existsSync(systemdUserUnitPath(homeDir));
  }
  if (platform === 'win32') {
    return existsSync(scheduledTaskXmlPath(homeDir));
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
  const run = options.run ?? defaultRun;
  const logPath = ensureLogDir(options.homeDir);
  const nodeExecPath = options.nodeExecPath ?? process.execPath;

  if (platform === 'win32') {
    const serveEntry = resolveNodeServeEntry(options.flowxBin);
    const taskXmlPath = scheduledTaskXmlPath(options.homeDir);
    mkdirSync(dirname(taskXmlPath), { recursive: true });
    const xml = renderScheduledTaskXml({
      nodeExecPath,
      flowxBin: serveEntry,
      logPath,
      userId: options.windowsUser ?? userInfo().username,
    });
    writeFileSync(taskXmlPath, `\uFEFF${xml}`, { encoding: 'utf16le' });
    await runOrThrow(run, 'schtasks', [
      '/Create',
      '/TN',
      WINDOWS_TASK_NAME,
      '/XML',
      taskXmlPath,
      '/F',
    ]);
    await runOrThrow(run, 'schtasks', ['/Run', '/TN', WINDOWS_TASK_NAME]);
    return { taskXmlPath };
  }

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
