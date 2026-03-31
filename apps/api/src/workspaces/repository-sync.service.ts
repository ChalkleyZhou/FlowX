import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { access, mkdir, rm } from 'fs/promises';
import { promisify } from 'util';
import { execFile as execFileCallback } from 'child_process';
import { basename, join } from 'path';

const execFile = promisify(execFileCallback);

type RepositoryRecord = {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  defaultBranch: string | null;
  currentBranch: string | null;
  localPath: string | null;
};

@Injectable()
export class RepositorySyncService {
  private readonly logger = new Logger(RepositorySyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async syncRepository(repository: RepositoryRecord) {
    const repoRoot = this.resolveRepositoryPath(repository.workspaceId, repository.id, repository.name);
    const targetBranch = repository.currentBranch?.trim() || repository.defaultBranch?.trim() || null;

    await this.prisma.repository.update({
      where: { id: repository.id },
      data: {
        localPath: repoRoot,
        syncStatus: 'SYNCING',
        syncError: null,
      },
    });

    try {
      await mkdir(this.getWorkspaceStoragePath(repository.workspaceId), { recursive: true });

      if (!(await this.pathExists(join(repoRoot, '.git')))) {
        await rm(repoRoot, { recursive: true, force: true });
        await this.runGit(['clone', repository.url, repoRoot]);
      }

      await this.runGit(['fetch', 'origin', '--prune'], repoRoot);

      let currentBranch = targetBranch;
      if (targetBranch) {
        const remoteBranchExists = await this.remoteBranchExists(repoRoot, targetBranch);
        if (remoteBranchExists) {
          await this.runGit(['checkout', '-B', targetBranch, `origin/${targetBranch}`], repoRoot);
          await this.runGit(['pull', '--ff-only', 'origin', targetBranch], repoRoot);
        } else {
          await this.runGit(['checkout', '-B', targetBranch], repoRoot);
        }
      } else {
        currentBranch = await this.getCurrentBranch(repoRoot);
        await this.runGit(['pull', '--ff-only'], repoRoot);
      }

      const resolvedBranch = currentBranch || (await this.getCurrentBranch(repoRoot));
      return this.prisma.repository.update({
        where: { id: repository.id },
        data: {
          localPath: repoRoot,
          currentBranch: resolvedBranch,
          syncStatus: 'READY',
          syncError: null,
          lastSyncedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown git sync error';
      this.logger.error(`Repository sync failed for ${repository.id}: ${message}`);
      await this.prisma.repository.update({
        where: { id: repository.id },
        data: {
          localPath: repoRoot,
          syncStatus: 'ERROR',
          syncError: message,
        },
      });
      throw new InternalServerErrorException(`代码库同步失败：${message}`);
    }
  }

  async syncWorkspaceRepositories(workspaceId: string) {
    const repositories = await this.prisma.repository.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });

    for (const repository of repositories) {
      await this.syncRepository(repository);
    }
  }

  async prepareWorkflowRepositories(workflowRunId: string) {
    const workflowRepositories = await this.prisma.workflowRepository.findMany({
      where: { workflowRunId },
      orderBy: { createdAt: 'asc' },
    });

    for (const workflowRepository of workflowRepositories) {
      await this.prepareWorkflowRepository(workflowRepository.id);
    }
  }

  async prepareWorkflowRepository(workflowRepositoryId: string) {
    const workflowRepository = await this.prisma.workflowRepository.findUniqueOrThrow({
      where: { id: workflowRepositoryId },
      include: { repository: true },
    });

    if (!workflowRepository.localPath) {
      throw new InternalServerErrorException('工作流代码库未绑定本地路径。');
    }

    await this.prisma.workflowRepository.update({
      where: { id: workflowRepositoryId },
      data: {
        status: 'PREPARING',
        syncError: null,
      },
    });

    try {
      await mkdir(this.getWorkflowStoragePath(workflowRepository.workflowRunId), {
        recursive: true,
      });

      if (workflowRepository.repository) {
        await this.syncRepository(workflowRepository.repository);
        const sourcePath = workflowRepository.repository.localPath;
        if (!sourcePath) {
          throw new InternalServerErrorException('源代码库尚未同步到本地。');
        }

        if (!(await this.pathExists(join(workflowRepository.localPath, '.git')))) {
          await rm(workflowRepository.localPath, { recursive: true, force: true });
          await this.runGit(
            ['clone', '--no-hardlinks', sourcePath, workflowRepository.localPath],
          );
        }
      } else if (!(await this.pathExists(join(workflowRepository.localPath, '.git')))) {
        throw new InternalServerErrorException('工作流代码库副本不存在，无法继续准备分支。');
      }

      await this.removeStaleIndexLock(workflowRepository.localPath);

      if (await this.remoteNamedOriginExists(workflowRepository.localPath)) {
        await this.runGit(['fetch', 'origin', '--prune'], workflowRepository.localPath);
      }

      const remoteBaseExists = await this.remoteBranchExists(
        workflowRepository.localPath,
        workflowRepository.baseBranch,
      );

      if (remoteBaseExists) {
        await this.runGit(
          ['checkout', '-B', workflowRepository.baseBranch, `origin/${workflowRepository.baseBranch}`],
          workflowRepository.localPath,
        );
        await this.runGit(
          ['pull', '--ff-only', 'origin', workflowRepository.baseBranch],
          workflowRepository.localPath,
        );
      } else {
        await this.runGit(
          ['checkout', '-B', workflowRepository.baseBranch],
          workflowRepository.localPath,
        );
      }

      await this.runGit(
        ['checkout', '-B', workflowRepository.workingBranch],
        workflowRepository.localPath,
      );

      return this.prisma.workflowRepository.update({
        where: { id: workflowRepositoryId },
        data: {
          status: 'READY',
          syncError: null,
          preparedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown workflow branch error';
      this.logger.error(`Workflow repository prepare failed for ${workflowRepositoryId}: ${message}`);
      await this.prisma.workflowRepository.update({
        where: { id: workflowRepositoryId },
        data: {
          status: 'ERROR',
          syncError: message,
        },
      });
      throw new InternalServerErrorException(`工作流分支准备失败：${message}`);
    }
  }

  buildWorkflowRepositoryPath(
    workflowRunId: string,
    workflowRepositoryId: string,
    repositoryName: string,
  ) {
    return join(
      this.getWorkflowStoragePath(workflowRunId),
      `${this.slugify(repositoryName)}-${workflowRepositoryId.slice(0, 8)}`,
    );
  }

  async removeWorkflowStorage(workflowRunId: string) {
    const workflowStoragePath = this.getWorkflowStoragePath(workflowRunId);
    await rm(workflowStoragePath, { recursive: true, force: true });
  }

  async removeRepositoryStorage(workspaceId: string, repositoryId: string, repositoryName: string) {
    const repositoryPath = this.resolveRepositoryPath(workspaceId, repositoryId, repositoryName);
    await rm(repositoryPath, { recursive: true, force: true });
  }

  private async runGit(args: string[], cwd?: string) {
    const { stderr } = await execFile('git', args, {
      cwd,
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
    });

    return stderr;
  }

  private async getCurrentBranch(cwd: string) {
    const { stdout } = await execFile(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      {
        cwd,
        env: process.env,
      },
    );

    return stdout.trim();
  }

  private async remoteBranchExists(cwd: string, branch: string) {
    try {
      await execFile(
        'git',
        ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`],
        {
          cwd,
          env: process.env,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  private resolveRepositoryPath(workspaceId: string, repositoryId: string, repositoryName: string) {
    return join(
      this.getWorkspaceStoragePath(workspaceId),
      `${this.slugify(repositoryName)}-${repositoryId.slice(0, 8)}`,
    );
  }

  private getWorkspaceStoragePath(workspaceId: string) {
    const root = process.env.WORKSPACE_REPOS_ROOT?.trim()
      ? process.env.WORKSPACE_REPOS_ROOT.trim()
      : join(process.cwd(), '.flowx-data', 'workspaces');
    return join(root, workspaceId, 'repositories');
  }

  private getWorkflowStoragePath(workflowRunId: string) {
    const root = process.env.WORKSPACE_REPOS_ROOT?.trim()
      ? process.env.WORKSPACE_REPOS_ROOT.trim()
      : join(process.cwd(), '.flowx-data', 'workflows');
    return join(root, workflowRunId, 'repositories');
  }

  private slugify(input: string) {
    const fallback = basename(input).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return fallback.replace(/^-+|-+$/g, '') || 'repository';
  }

  private async pathExists(path: string) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async removeStaleIndexLock(localPath: string) {
    const lockPath = join(localPath, '.git', 'index.lock');
    if (await this.pathExists(lockPath)) {
      await rm(lockPath, { force: true });
    }
  }

  private async remoteNamedOriginExists(localPath: string) {
    try {
      await execFile(
        'git',
        ['remote', 'get-url', 'origin'],
        {
          cwd: localPath,
          env: process.env,
        },
      );
      return true;
    } catch {
      return false;
    }
  }
}
