import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { execFile, spawn, type ChildProcess } from 'child_process';
import * as net from 'net';
import { promisify } from 'util';
import { PrismaService } from '../prisma/prisma.service';
import { detectLocalDevCommand, formatShellCommand, resolveSpawnArgs, type PackageManager } from './detect-local-dev-command';
import {
  dependenciesLookInstalled,
  installCommandForPackageManager,
  resolveDependencyInstallCwd,
  resolveInstallPackageManager,
  suggestFromDevLogTail,
} from './local-dev-deps';

type LocalDevSessionStatus = 'idle' | 'starting' | 'running' | 'failed' | 'stopped';

type LocalDevSession = {
  status: LocalDevSessionStatus;
  cwd?: string;
  packageManager?: PackageManager;
  scriptName?: string;
  port?: number;
  previewUrl?: string;
  shellCommand?: string;
  logTail: string;
  startedAt?: number;
  childPid?: number;
  lastError?: string;
};

function isLocalDevPreviewGloballyDisabled(): boolean {
  const raw = process.env.FLOWX_LOCAL_DEV_PREVIEW?.trim().toLowerCase();
  return raw === '0' || raw === 'false' || raw === 'no' || raw === 'off';
}

function shouldAutoStartAfterDesign(): boolean {
  const raw = process.env.FLOWX_DESIGN_AUTO_START_LOCAL_PREVIEW?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }
  return true;
}

function shouldAutoInstallDependencies(): boolean {
  const raw = process.env.FLOWX_LOCAL_DEV_AUTO_INSTALL?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }
  return true;
}

const execFileAsync = promisify(execFile);
const INSTALL_TIMEOUT_MS = Number(process.env.FLOWX_LOCAL_DEV_INSTALL_TIMEOUT_MS?.trim()) || 600_000;

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to resolve ephemeral port.'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPortOpen(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    if (ok) {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for dev server on port ${port}.`);
}

@Injectable()
export class LocalDevPreviewService {
  private readonly logger = new Logger(LocalDevPreviewService.name);
  private readonly sessions = new Map<string, LocalDevSession>();
  private readonly processes = new Map<string, ChildProcess>();

  constructor(private readonly prisma: PrismaService) {}

  isEnabled(): boolean {
    return !isLocalDevPreviewGloballyDisabled();
  }

  shouldAutoStartAfterDesignWrite(): boolean {
    return this.isEnabled() && shouldAutoStartAfterDesign();
  }

  async detectRepositoryCommand(repositoryId: string) {
    const repo = await this.getRepositoryOrThrow(repositoryId);
    const localPath = repo.localPath?.trim();
    if (!localPath) {
      throw new BadRequestException('Repository has no localPath; sync the repository first.');
    }
    const detected = detectLocalDevCommand(localPath);
    if (!detected) {
      throw new BadRequestException('Could not detect a dev script (dev/develop/start:dev/...) in package.json.');
    }
    return {
      repositoryId,
      localPath,
      cwd: detected.cwd,
      packageManager: detected.packageManager,
      scriptName: detected.scriptName,
      shellCommand: detected.shellCommand,
    };
  }

  getStatus(repositoryId: string) {
    const session = this.sessions.get(repositoryId) ?? { status: 'idle' as const, logTail: '' };
    return {
      repositoryId,
      running: session.status === 'running',
      status: session.status,
      previewUrl: session.previewUrl,
      port: session.port,
      cwd: session.cwd,
      shellCommand: session.shellCommand,
      logTail: session.logTail ?? '',
      lastError: session.lastError,
    };
  }

  async stop(repositoryId: string) {
    const child = this.processes.get(repositoryId);
    if (child?.pid) {
      try {
        if (process.platform !== 'win32') {
          process.kill(-child.pid, 'SIGTERM');
        } else {
          child.kill('SIGTERM');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to SIGTERM dev preview for repository ${repositoryId}: ${message}`);
      }
    }
    this.processes.delete(repositoryId);
    const prev = this.sessions.get(repositoryId);
    this.sessions.set(repositoryId, {
      status: 'stopped',
      logTail: prev?.logTail ?? '',
      lastError: undefined,
    });
    return this.getStatus(repositoryId);
  }

  async restartAfterDesignWrite(repositoryId: string): Promise<void> {
    if (!this.shouldAutoStartAfterDesignWrite()) {
      return;
    }
    try {
      await this.start(repositoryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Auto-start local dev preview failed for repository ${repositoryId}: ${message}`);
    }
  }

  async start(repositoryId: string) {
    if (!this.isEnabled()) {
      throw new BadRequestException('Local dev preview is disabled (FLOWX_LOCAL_DEV_PREVIEW).');
    }

    await this.stop(repositoryId);

    const repo = await this.getRepositoryOrThrow(repositoryId);
    const localPath = repo.localPath?.trim();
    if (!localPath) {
      throw new BadRequestException('Repository has no localPath; sync the repository first.');
    }

    const detected = detectLocalDevCommand(localPath);
    if (!detected) {
      throw new BadRequestException('Could not detect a dev script in package.json.');
    }

    if (shouldAutoInstallDependencies() && !dependenciesLookInstalled(localPath, detected)) {
      const installCwd = resolveDependencyInstallCwd(localPath, detected);
      const installPm = resolveInstallPackageManager(localPath, detected);
      const { command, args } = installCommandForPackageManager(installPm);
      this.logger.log(
        `Local dev preview: installing dependencies in ${installCwd} (${command} ${args.join(' ')}) for repository ${repositoryId} (detectedDevPm=${detected.packageManager}, installPm=${installPm})`,
      );
      try {
        const { stdout, stderr } = await execFileAsync(command, args, {
          cwd: installCwd,
          env: { ...process.env, CI: '1' },
          maxBuffer: 20 * 1024 * 1024,
          timeout: INSTALL_TIMEOUT_MS,
        });
        const combined = `${stdout ?? ''}\n${stderr ?? ''}`.trimEnd();
        if (combined) {
          this.logger.log(`Local dev preview: install output tail for ${repositoryId}:\n${combined.slice(-3000)}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stderr = (error as { stderr?: Buffer }).stderr?.toString?.() ?? '';
        this.logger.error(
          `Local dev preview: dependency install failed for ${repositoryId}: ${message}\n${stderr.slice(0, 4000)}`,
        );
        throw new BadRequestException(
          `Dependency install failed in ${installCwd} (${command} ${args.join(' ')}): ${message}. Install manually in that directory, then retry local preview.`,
        );
      }
      if (!dependenciesLookInstalled(localPath, detected)) {
        throw new BadRequestException(
          `Dependencies still missing after install (expected node_modules under ${detected.cwd} or repository root ${localPath}). Run ${command} ${args.join(' ')} manually and verify.`,
        );
      }
    } else if (!dependenciesLookInstalled(localPath, detected)) {
      this.logger.warn(
        `Local dev preview: node_modules missing under ${detected.cwd} (and possibly repo root); auto-install is off (FLOWX_LOCAL_DEV_AUTO_INSTALL). Dev server may fail until you install dependencies.`,
      );
    }

    const port = await pickFreePort();
    const forwarded = ['--port', String(port), '--host', '127.0.0.1'];
    const { command, args } = resolveSpawnArgs(detected.packageManager, detected.scriptName, forwarded);
    const shellCommand = formatShellCommand(detected.packageManager, detected.scriptName, forwarded);

    const session: LocalDevSession = {
      status: 'starting',
      cwd: detected.cwd,
      packageManager: detected.packageManager,
      scriptName: detected.scriptName,
      port,
      shellCommand,
      logTail: '',
      startedAt: Date.now(),
    };
    this.sessions.set(repositoryId, session);

    const appendLog = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const current = this.sessions.get(repositoryId) ?? session;
      current.logTail = (current.logTail + text).slice(-8000);
    };

    const child = spawn(command, args, {
      cwd: detected.cwd,
      env: {
        ...process.env,
        PORT: String(port),
        BROWSER: 'none',
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processes.set(repositoryId, child);
    session.childPid = child.pid;

    child.stdout?.on('data', appendLog);
    child.stderr?.on('data', appendLog);

    child.on('error', (error) => {
      const current = this.sessions.get(repositoryId) ?? session;
      current.status = 'failed';
      current.lastError = error.message;
      appendLog(`\n[process error] ${error.message}\n`);
    });

    child.on('exit', (code, signal) => {
      const current = this.sessions.get(repositoryId);
      if (!current || current.status === 'stopped') {
        this.processes.delete(repositoryId);
        return;
      }
      if (current.status === 'starting' || current.status === 'running') {
        current.status = 'failed';
        const hint = suggestFromDevLogTail(current.logTail ?? '');
        current.lastError = `Dev process exited early (code=${code ?? 'null'}, signal=${signal ?? 'null'}).${hint}`;
        appendLog(`\n[exit] code=${code} signal=${signal}\n`);
      }
      this.processes.delete(repositoryId);
    });

    this.finalizeStartup(repositoryId, port);
    return this.getStatus(repositoryId);
  }

  private finalizeStartup(repositoryId: string, port: number) {
    void (async () => {
      const session = this.sessions.get(repositoryId);
      if (!session || session.status !== 'starting') {
        return;
      }
      try {
        await waitForPortOpen(port, 120_000);
        session.status = 'running';
        session.previewUrl = `http://127.0.0.1:${port}/`;
        this.logger.log(`Local dev preview running for repository ${repositoryId} at ${session.previewUrl}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        session.status = 'failed';
        const hint = suggestFromDevLogTail(session.logTail ?? '');
        session.lastError = hint ? `${message}${hint}` : message;
        const append = (text: string) => {
          session.logTail = (session.logTail + text).slice(-8000);
        };
        append(`\n[wait] ${message}\n`);
        const proc = this.processes.get(repositoryId);
        if (proc?.pid) {
          try {
            if (process.platform !== 'win32') {
              process.kill(-proc.pid, 'SIGTERM');
            } else {
              proc.kill('SIGTERM');
            }
          } catch (killError) {
            const killMessage = killError instanceof Error ? killError.message : String(killError);
            this.logger.warn(`Failed to terminate dev preview after wait failure: ${killMessage}`);
          }
        }
        this.processes.delete(repositoryId);
      }
    })();
  }

  private async getRepositoryOrThrow(repositoryId: string) {
    const repo = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { id: true, localPath: true, syncStatus: true },
    });
    if (!repo) {
      throw new NotFoundException('Repository not found.');
    }
    return repo;
  }
}
