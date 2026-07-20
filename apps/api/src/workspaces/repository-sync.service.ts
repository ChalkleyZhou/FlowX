import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Repository } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GitCredentialsService } from '../auth/git-credentials.service';
import { parseRepositoryRemote } from '../briefings/repository-remote';
import {
  applyHttpAccessTokenToCloneUrl,
  buildGitAuthEnv,
  isHttpRepositoryUrl,
  resolveGitRemoteAuth,
} from './git-remote-auth';
import { access, mkdir, readdir, readFile, rm } from 'fs/promises';
import { promisify } from 'util';
import { execFile as execFileCallback } from 'child_process';
import { basename, join } from 'path';

const execFile = promisify(execFileCallback);

const GIT_CLONE_TIMEOUT_MS = 900_000;
const GIT_OPERATION_TIMEOUT_MS = 180_000;

const GIT_LOG_FIELD_SEP = '\x1f';
const GIT_LOG_FORMAT = `%H${GIT_LOG_FIELD_SEP}%an${GIT_LOG_FIELD_SEP}%aI${GIT_LOG_FIELD_SEP}%s`;

export function parseGitLogOutput(
  stdout: string,
  fallbackOccurredAt: string,
): Array<{ id: string; message: string; author?: string; occurredAt: string }> {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, author, occurredAt, message] = line.split(GIT_LOG_FIELD_SEP);
      return {
        id: id ?? '',
        message: message ?? '',
        author: author?.trim() || undefined,
        occurredAt: occurredAt?.trim() || fallbackOccurredAt,
      };
    })
    .filter((commit) => Boolean(commit.id));
}

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
  private readonly syncingRepositoryIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitCredentialsService: GitCredentialsService,
  ) {}

  scheduleRepositorySync(repository: RepositoryRecord) {
    if (this.syncingRepositoryIds.has(repository.id)) {
      return;
    }

    this.syncingRepositoryIds.add(repository.id);
    void this.syncRepository(repository)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Background repository sync failed for ${repository.id}: ${message}`);
      })
      .finally(() => {
        this.syncingRepositoryIds.delete(repository.id);
      });
  }

  async syncRepository(
    repository: RepositoryRecord,
    options?: { branch?: string | null; requireRemoteBranch?: boolean },
  ) {
    const repoRoot = this.resolveRepositoryPath(repository.workspaceId, repository.id, repository.name);
    const targetBranch =
      this.normalizeBranchRef(options?.branch) ||
      this.normalizeBranchRef(repository.currentBranch) ||
      this.normalizeBranchRef(repository.defaultBranch);

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
      const remoteAuth = await this.resolveRemoteAuth(repository.url);
      if (isHttpRepositoryUrl(repository.url) && !remoteAuth) {
        throw new InternalServerErrorException(
          'HTTP 仓库同步需要 Git 凭据：请在「Git 凭据」中配置 GitLab Access Token，或设置 GITLAB_TOKEN 环境变量。',
        );
      }

      if (!(await this.pathExists(join(repoRoot, '.git')))) {
        await rm(repoRoot, { recursive: true, force: true });
        const cloneUrl = applyHttpAccessTokenToCloneUrl(repository.url, remoteAuth);
        await this.runGit(['clone', cloneUrl, repoRoot], undefined, remoteAuth);
      }

      await this.runGit(['fetch', 'origin', '--prune'], repoRoot, remoteAuth);

      let currentBranch = targetBranch;
      if (targetBranch) {
        const remoteBranchExists = await this.remoteBranchExists(repoRoot, targetBranch);
        if (remoteBranchExists) {
          await this.runGit(['checkout', '-B', targetBranch, `origin/${targetBranch}`], repoRoot, remoteAuth);
          await this.runGit(['pull', '--ff-only', 'origin', targetBranch], repoRoot, remoteAuth);
        } else if (options?.requireRemoteBranch) {
          throw new InternalServerErrorException(
            `远端不存在分支「${targetBranch}」，无法检出待审查提交。请确认 webhook 中的分支名与远端一致。`,
          );
        } else {
          await this.runGit(['checkout', '-B', targetBranch], repoRoot, remoteAuth);
        }
      } else {
        currentBranch = await this.getCurrentBranch(repoRoot);
        await this.runGit(['pull', '--ff-only'], repoRoot, remoteAuth);
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
      const message = this.formatGitSyncError(error);
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

  /**
   * Clone/fetch/checkout a repository into the Code Review sandbox tree.
   * Does not mutate Repository.localPath (main workspace checkout stays untouched).
   */
  async ensureCodeReviewSandbox(
    repository: {
      id: string;
      workspaceId: string;
      name: string;
      url: string;
      defaultBranch: string | null;
      currentBranch: string | null;
    },
    branch: string,
  ): Promise<{
    localPath: string;
    branch: string;
    syncStatus: 'READY' | 'ERROR';
    syncError?: string;
  }> {
    const sandboxPath = this.resolveCodeReviewRepositoryPath(
      repository.workspaceId,
      repository.id,
      repository.name,
    );
    const targetBranch =
      this.normalizeBranchRef(branch) ||
      this.normalizeBranchRef(repository.currentBranch) ||
      this.normalizeBranchRef(repository.defaultBranch) ||
      'main';

    try {
      await mkdir(this.getCodeReviewStoragePath(repository.workspaceId), { recursive: true });
      const remoteAuth = await this.resolveRemoteAuth(repository.url);
      if (isHttpRepositoryUrl(repository.url) && !remoteAuth) {
        throw new InternalServerErrorException(
          'HTTP 仓库同步需要 Git 凭据：请在「Git 凭据」中配置 GitLab Access Token，或设置 GITLAB_TOKEN 环境变量。',
        );
      }

      if (!(await this.pathExists(join(sandboxPath, '.git')))) {
        await rm(sandboxPath, { recursive: true, force: true });
        const cloneUrl = applyHttpAccessTokenToCloneUrl(repository.url, remoteAuth);
        await this.runGit(['clone', cloneUrl, sandboxPath], undefined, remoteAuth);
      }

      await this.removeStaleIndexLock(sandboxPath);
      await this.runGit(['fetch', 'origin', '--prune'], sandboxPath, remoteAuth);

      const remoteBranchExists = await this.remoteBranchExists(sandboxPath, targetBranch);
      if (remoteBranchExists) {
        await this.runGit(
          ['checkout', '-B', targetBranch, `origin/${targetBranch}`],
          sandboxPath,
          remoteAuth,
        );
      } else {
        await this.runGit(['checkout', '-B', targetBranch], sandboxPath, remoteAuth);
      }

      return {
        localPath: sandboxPath,
        branch: targetBranch,
        syncStatus: 'READY',
      };
    } catch (error) {
      const message = this.formatGitSyncError(error);
      this.logger.error(`Code review sandbox sync failed for ${repository.id}: ${message}`);
      return {
        localPath: sandboxPath,
        branch: targetBranch,
        syncStatus: 'ERROR',
        syncError: message,
      };
    }
  }

  async ensureRepositoryReadyForReview(
    repository: RepositoryRecord,
    branch?: string | null,
    commitIds: string[] = [],
    options?: { retryCloneOnMissingCommits?: boolean },
  ): Promise<Repository> {
    const targetBranch = this.resolveReviewBranch(repository, branch);
    const repoRoot = this.resolveRepositoryPath(repository.workspaceId, repository.id, repository.name);

    try {
      const synced = await this.syncRepository(repository, {
        branch: targetBranch,
        requireRemoteBranch: true,
      });
      if (synced.syncStatus !== 'READY' || !synced.localPath) {
        throw new InternalServerErrorException(
          synced.syncError?.trim() || '代码库同步失败，无法运行 Code Review。',
        );
      }

      if (commitIds.length > 0) {
        await this.ensureCommitsAvailable(
          synced.localPath,
          repository.url,
          targetBranch ?? synced.currentBranch,
          commitIds,
        );
      }

      return synced;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldRetryClone =
        options?.retryCloneOnMissingCommits !== false &&
        commitIds.length > 0 &&
        message.includes('缺少待审查 commit');

      if (!shouldRetryClone) {
        throw error;
      }

      this.logger.warn(
        `Repository ${repository.id} missing review commits after sync; re-cloning once from remote.`,
      );
      await rm(repoRoot, { recursive: true, force: true });
      return this.ensureRepositoryReadyForReview(repository, branch, commitIds, {
        retryCloneOnMissingCommits: false,
      });
    }
  }

  /**
   * Collects commits directly from git for repositories that have no BriefingSource
   * (and therefore no webhook-derived evidence). Syncs the repository, then reads
   * `git log` on the target branch within [since, until).
   */
  async collectRecentCommits(
    repository: RepositoryRecord,
    options: { branch?: string | null; since: Date; until: Date },
  ): Promise<Array<{ id: string; message: string; author?: string; occurredAt: string }>> {
    const targetBranch = this.resolveReviewBranch(repository, options.branch);
    const synced = await this.syncRepository(repository, { branch: targetBranch });
    if (synced.syncStatus !== 'READY' || !synced.localPath) {
      throw new InternalServerErrorException(
        synced.syncError?.trim() || '代码库同步失败，无法收集提交记录。',
      );
    }

    const { stdout } = await execFile(
      'git',
      [
        'log',
        `--since=${options.since.toISOString()}`,
        `--until=${options.until.toISOString()}`,
        `--pretty=format:${GIT_LOG_FORMAT}`,
        '--no-color',
      ],
      { cwd: synced.localPath, env: process.env, maxBuffer: 4 * 1024 * 1024 },
    );

    return parseGitLogOutput(stdout, options.since.toISOString());
  }

  async buildCommitDiffBundle(
    localPath: string,
    commits: Array<{ id: string; message: string }>,
  ): Promise<string> {
    const sections: string[] = [];
    let totalChars = 0;
    const maxTotalChars = 100_000;
    const maxCharsPerCommit = 15_000;

    for (const commit of commits) {
      const shortMessage = commit.message.split('\n')[0]?.trim() || '(no message)';
      const header = `### commit ${commit.id}\n${shortMessage}`;

      try {
        const { stdout: stat } = await execFile(
          'git',
          ['show', '--stat', '--format=fuller', commit.id, '--no-color'],
          { cwd: localPath, env: process.env, maxBuffer: 2 * 1024 * 1024 },
        );
        const { stdout: patch } = await execFile(
          'git',
          ['show', commit.id, '--no-color', '-p', '--format='],
          { cwd: localPath, env: process.env, maxBuffer: 8 * 1024 * 1024 },
        );

        let body = `${stat.trim()}\n\n${patch.trim()}`;
        if (body.length > maxCharsPerCommit) {
          body = `${body.slice(0, maxCharsPerCommit)}\n...[diff truncated]`;
        }

        if (totalChars + body.length > maxTotalChars) {
          sections.push('...[剩余 commit diff 已省略，请缩小审查范围]');
          break;
        }

        sections.push(`${header}\n\n${body}`);
        totalChars += body.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new InternalServerErrorException(
          `无法读取 commit ${commit.id} 的 diff：${message}`,
        );
      }
    }

    return sections.join('\n\n');
  }

  private async ensureCommitsAvailable(
    cwd: string,
    remoteUrl: string,
    branch: string | null | undefined,
    commitIds: string[],
  ) {
    const auth = await this.resolveRemoteAuth(remoteUrl);
    const uniqueIds = [...new Set(commitIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) {
      return;
    }

    if (await this.isShallowRepository(cwd)) {
      try {
        await this.runGit(['fetch', '--unshallow', 'origin'], cwd, auth);
      } catch {
        await this.runGit(['fetch', 'origin', '--depth', '500'], cwd, auth);
      }
    }

    const normalizedBranch = branch?.trim();
    if (normalizedBranch && normalizedBranch !== 'unknown') {
      try {
        await this.runGit(['fetch', 'origin', normalizedBranch, '--depth', '300'], cwd, auth);
      } catch {
        // Branch fetch may fail for protected or deleted branches; per-commit fetch below.
      }
    }

    let missing = await this.findMissingCommits(cwd, uniqueIds);
    for (const commitId of missing) {
      try {
        await this.runGit(['fetch', 'origin', commitId], cwd, auth);
      } catch {
        // Continue; we'll report all still-missing commits together.
      }
    }

    missing = await this.findMissingCommits(cwd, uniqueIds);
    if (missing.length > 0) {
      const preview = missing.slice(0, 3).join(', ');
      const suffix = missing.length > 3 ? ` 等 ${missing.length} 个` : '';
      throw new InternalServerErrorException(
        `本地仓库缺少待审查 commit（${preview}${suffix}），无法获取 diff。请确认 Git 凭据有效且远端仍存在这些提交。`,
      );
    }
  }

  private async findMissingCommits(cwd: string, commitIds: string[]) {
    const missing: string[] = [];
    for (const commitId of commitIds) {
      if (!(await this.commitExists(cwd, commitId))) {
        missing.push(commitId);
      }
    }
    return missing;
  }

  private async commitExists(cwd: string, commitId: string) {
    try {
      await execFile('git', ['cat-file', '-e', `${commitId}^{commit}`], {
        cwd,
        env: process.env,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async isShallowRepository(cwd: string) {
    try {
      const { stdout } = await execFile('git', ['rev-parse', '--is-shallow-repository'], {
        cwd,
        env: process.env,
      });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  private resolveReviewBranch(repository: RepositoryRecord, branch?: string | null) {
    const normalized = this.normalizeBranchRef(branch);
    if (normalized) {
      return normalized;
    }
    return (
      this.normalizeBranchRef(repository.currentBranch) ||
      this.normalizeBranchRef(repository.defaultBranch)
    );
  }

  private normalizeBranchRef(branch?: string | null) {
    const normalized = branch?.trim().replace(/^refs\/(heads|tags)\//, '');
    if (!normalized || normalized === 'unknown') {
      return null;
    }
    return normalized;
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

  async generateWorkflowRepositoryGrounding(workflowRunId: string) {
    const workflowRepositories = await this.prisma.workflowRepository.findMany({
      where: { workflowRunId },
      orderBy: { createdAt: 'asc' },
    });

    for (const workflowRepository of workflowRepositories) {
      const snapshot = await this.buildWorkflowRepositoryGrounding(workflowRepository.localPath);
      await this.prisma.workflowRepository.update({
        where: { id: workflowRepository.id },
        data: {
          contextSnapshot: snapshot as never,
          contextGeneratedAt: snapshot ? new Date() : null,
        },
      });
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

      const remoteAuth = workflowRepository.repository
        ? await this.resolveRemoteAuth(workflowRepository.repository.url)
        : null;

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
        await this.runGit(['fetch', 'origin', '--prune'], workflowRepository.localPath, remoteAuth);
      }

      const remoteBaseExists = await this.remoteBranchExists(
        workflowRepository.localPath,
        workflowRepository.baseBranch,
      );

      if (remoteBaseExists) {
        await this.runGit(
          ['checkout', '-B', workflowRepository.baseBranch, `origin/${workflowRepository.baseBranch}`],
          workflowRepository.localPath,
          remoteAuth,
        );
        await this.runGit(
          ['pull', '--ff-only', 'origin', workflowRepository.baseBranch],
          workflowRepository.localPath,
          remoteAuth,
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

  private async resolveRemoteAuth(remoteUrl: string) {
    const parsed = parseRepositoryRemote(remoteUrl);
    if (!parsed) {
      return null;
    }

    const token = await this.gitCredentialsService.getAccessTokenForProvider(parsed.provider);
    return resolveGitRemoteAuth(remoteUrl, token);
  }

  private buildGitEnv(auth?: ReturnType<typeof resolveGitRemoteAuth>) {
    return {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      ...buildGitAuthEnv(auth ?? null),
    };
  }

  private resolveGitTimeoutMs(args: string[]) {
    return args[0] === 'clone' ? GIT_CLONE_TIMEOUT_MS : GIT_OPERATION_TIMEOUT_MS;
  }

  private formatGitSyncError(error: unknown) {
    if (!(error instanceof Error)) {
      return 'Unknown git sync error';
    }

    const errorWithCode = error as Error & { code?: string; killed?: boolean; signal?: string };
    if (errorWithCode.code === 'ETIMEDOUT' || errorWithCode.killed) {
      return `Git 命令超时（${error.message}）`;
    }

    if (error.message.includes('could not read Username')) {
      return `HTTP 仓库认证失败：请确认已在「Git 凭据」配置 GitLab Access Token（或 GITLAB_TOKEN 环境变量）。原始错误：${error.message}`;
    }

    return error.message;
  }

  private async runGit(
    args: string[],
    cwd?: string,
    auth?: ReturnType<typeof resolveGitRemoteAuth>,
  ) {
    const { stderr } = await execFile('git', args, {
      cwd,
      env: this.buildGitEnv(auth),
      maxBuffer: 1024 * 1024 * 8,
      timeout: this.resolveGitTimeoutMs(args),
      killSignal: 'SIGTERM',
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

  private resolveCodeReviewRepositoryPath(
    workspaceId: string,
    repositoryId: string,
    repositoryName: string,
  ) {
    return join(
      this.getCodeReviewStoragePath(workspaceId),
      `${this.slugify(repositoryName)}-${repositoryId.slice(0, 8)}`,
    );
  }

  private getWorkspaceStoragePath(workspaceId: string) {
    const root = process.env.WORKSPACE_REPOS_ROOT?.trim()
      ? process.env.WORKSPACE_REPOS_ROOT.trim()
      : join(process.cwd(), '.flowx-data', 'workspaces');
    return join(root, workspaceId, 'repositories');
  }

  private getCodeReviewStoragePath(workspaceId: string) {
    const root = process.env.CODE_REVIEW_REPOS_ROOT?.trim()
      ? process.env.CODE_REVIEW_REPOS_ROOT.trim()
      : join(process.cwd(), '.flowx-data', 'code-review', 'workspaces');
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

  private async buildWorkflowRepositoryGrounding(localPath?: string | null) {
    if (!localPath || !(await this.pathExists(localPath))) {
      return null;
    }

    const docsSnapshot = await this.buildDocsFirstSnapshot(localPath);
    const structuralSnapshot = await this.buildStructuralSnapshot(localPath);

    if (!docsSnapshot) {
      return structuralSnapshot;
    }

    const evidenceFiles = Array.from(
      new Set([
        ...(docsSnapshot.evidenceFiles ?? []),
        ...(structuralSnapshot.evidenceFiles ?? []),
      ]),
    );

    const summarySections = [
      docsSnapshot.summary?.trim() ? docsSnapshot.summary.trim() : '',
      structuralSnapshot.summary?.trim()
        ? `补充仓库结构证据:\n${structuralSnapshot.summary.trim()}`
        : '',
    ].filter(Boolean);

    return {
      strategy: 'docs-and-structure',
      summary: summarySections.join('\n\n'),
      evidenceFiles,
    };
  }

  private async buildDocsFirstSnapshot(localPath: string) {
    const candidateFiles = [
      'AGENTS.md',
      'AGENT.md',
      'README.md',
      'README',
      'README.zh-CN.md',
      'README.zh.md',
      'CONTRIBUTING.md',
      'docs/README.md',
    ];

    const matchedSections: string[] = [];
    const evidenceFiles: string[] = [];

    for (const relativePath of candidateFiles) {
      const absolutePath = join(localPath, relativePath);
      if (!(await this.pathExists(absolutePath))) {
        continue;
      }

      const content = (await readFile(absolutePath, 'utf8')).trim();
      if (!content) {
        continue;
      }

      evidenceFiles.push(relativePath);
      matchedSections.push(`- ${relativePath}\n${this.truncateText(content, 3200)}`);

      if (evidenceFiles.length >= 3) {
        break;
      }
    }

    if (matchedSections.length === 0) {
      return null;
    }

    return {
      strategy: 'docs-first',
      summary: `优先依据仓库说明文件理解项目上下文：\n${matchedSections.join('\n\n')}`,
      evidenceFiles,
    };
  }

  private async buildStructuralSnapshot(localPath: string) {
    const rootEntries = await this.readDirectoryEntries(localPath, 30);
    const manifestFiles = [
      'package.json',
      'pnpm-workspace.yaml',
      'turbo.json',
      'go.mod',
      'Cargo.toml',
      'pyproject.toml',
      'requirements.txt',
      'pom.xml',
      'build.gradle',
      'Makefile',
    ];
    const presentManifestFiles: string[] = [];
    for (const file of manifestFiles) {
      if (await this.pathExists(join(localPath, file))) {
        presentManifestFiles.push(file);
      }
    }

    const focusDirs = ['apps', 'packages', 'services', 'cmd', 'src', 'internal', 'api', 'web', 'client', 'server', 'docs', 'tests', 'test'];
    const focusSections: string[] = [];
    for (const dir of focusDirs) {
      const entries = await this.readDirectoryEntries(join(localPath, dir), 20);
      if (entries.length > 0) {
        focusSections.push(`${dir}/:\n${entries.map((entry) => `  - ${entry}`).join('\n')}`);
      }
    }

    const packageSummary = await this.readPackageJsonSummary(localPath);
    const summarySections = [
      rootEntries.length > 0 ? `仓库根目录:\n${rootEntries.map((entry) => `  - ${entry}`).join('\n')}` : '',
      presentManifestFiles.length > 0 ? `可识别构建/包管理文件:\n${presentManifestFiles.map((file) => `  - ${file}`).join('\n')}` : '',
      packageSummary ? `package.json 摘要:\n${packageSummary}` : '',
      ...focusSections,
    ].filter(Boolean);

    return {
      strategy: 'structural-scan',
      summary: summarySections.join('\n\n'),
      evidenceFiles: presentManifestFiles,
    };
  }

  private async readDirectoryEntries(path: string, limit: number) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, limit)
        .map((entry) => `${entry.isDirectory() ? '[D]' : '[F]'} ${entry.name}`);
    } catch {
      return [];
    }
  }

  private async readPackageJsonSummary(localPath: string) {
    try {
      const packageJson = JSON.parse(await readFile(join(localPath, 'package.json'), 'utf8')) as {
        name?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const scriptNames = Object.keys(packageJson.scripts ?? {}).slice(0, 12);
      const dependencyNames = [
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.devDependencies ?? {}),
      ].slice(0, 20);

      return [
        packageJson.name ? `  - name: ${packageJson.name}` : '',
        scriptNames.length > 0 ? `  - scripts: ${scriptNames.join(', ')}` : '',
        dependencyNames.length > 0 ? `  - dependencies: ${dependencyNames.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    } catch {
      return '';
    }
  }

  private truncateText(value: string, maxLength: number) {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength)}\n...[truncated]`;
  }
}
