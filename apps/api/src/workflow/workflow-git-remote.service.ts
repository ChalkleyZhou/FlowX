import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { GitCredentialsService } from '../auth/git-credentials.service';
import { parseRepositoryRemote } from '../briefings/repository-remote';
import { buildGitAuthEnv, resolveGitRemoteAuth } from '../workspaces/git-remote-auth';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runGit = promisify(execFile);

export interface BranchInspection {
  headSha: string;
  baseSha: string;
  changedFiles: string[];
  diffStat: string;
  diffText: string;
}

export function compareRemoteSha(remoteSha: string, headSha: string): boolean {
  const normalizedRemote = remoteSha.trim().toLowerCase();
  const normalizedHead = headSha.trim().toLowerCase();
  if (!normalizedRemote || !normalizedHead) {
    return false;
  }
  return (
    normalizedRemote === normalizedHead ||
    normalizedRemote.startsWith(normalizedHead) ||
    normalizedHead.startsWith(normalizedRemote)
  );
}

export function buildGitRemoteVerificationEnv(
  remoteUrl: string,
  token: string | null | undefined,
): NodeJS.ProcessEnv {
  const parsed = parseRepositoryRemote(remoteUrl);
  const auth = parsed ? resolveGitRemoteAuth(remoteUrl, token) : null;
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    ...buildGitAuthEnv(auth),
  };
}

@Injectable()
export class WorkflowGitRemoteService {
  constructor(private readonly gitCredentialsService: GitCredentialsService) {}

  async resolveBranchHead(remoteUrl: string, branch: string, organizationId: string): Promise<string> {
    await this.validateBranch(branch);
    const env = await this.remoteEnv(remoteUrl, organizationId);
    try {
      const { stdout } = await runGit('git', ['ls-remote', '--heads', '--', remoteUrl, `refs/heads/${branch}`], {
        env, timeout: 30_000, maxBuffer: 1024 * 1024,
      });
      const head = stdout.split('\n').map(line => line.trim().split(/\s+/))
        .find(([, ref]) => ref === `refs/heads/${branch}`)?.[0];
      if (head && /^[a-f0-9]{40,64}$/i.test(head)) return head.toLowerCase();
    } catch {
      throw new BadRequestException('无法读取远程分支，请确认分支已推送，且平台具有仓库读取权限。');
    }
    throw new BadRequestException('远程分支不存在，请先推送分支再提交。');
  }

  /** 只在隔离 bare 仓库读取 Git 对象，不切换或修改开发者工作目录。 */
  async inspectBranch(remoteUrl: string, baseBranch: string, branch: string, expectedHeadSha: string, organizationId: string): Promise<BranchInspection> {
    await this.validateBranch(branch);
    await this.validateBranch(baseBranch);
    const env = await this.remoteEnv(remoteUrl, organizationId);
    const directory = await mkdtemp(join(tmpdir(), 'flowx-delivery-'));
    const git = async (args: string[]) => (await runGit('git', args, {
      cwd: directory, env, timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
    })).stdout;
    try {
      await git(['init', '--bare', '--quiet']);
      await git(['fetch', '--quiet', '--no-tags', '--', remoteUrl,
        `+refs/heads/${baseBranch}:refs/heads/flowx-base`,
        `+refs/heads/${branch}:refs/heads/flowx-delivery`]);
      const headSha = (await git(['rev-parse', 'refs/heads/flowx-delivery'])).trim();
      if (headSha !== expectedHeadSha) {
        throw new ConflictException('分支已有新提交，请重新提交分支并核对版本后再确认交付。');
      }
      const baseSha = (await git(['merge-base', 'refs/heads/flowx-base', headSha])).trim();
      const changedFiles = (await git(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', baseSha, headSha, '--']))
        .split('\0').filter(Boolean);
      if (!changedFiles.length) throw new BadRequestException('所选分支相对基线没有代码差异，不能确认为代码交付。');
      const diffStat = await git(['diff', '--no-ext-diff', '--no-textconv', '--stat', baseSha, headSha, '--']);
      const diffText = await git(['diff', '--no-ext-diff', '--no-textconv', '--binary', baseSha, headSha, '--']);
      return { headSha, baseSha, changedFiles, diffStat, diffText };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
      // Git stderr 可能包含带凭据的 URL，不直接传播给页面或日志。
      throw new BadRequestException('无法读取交付差异，请检查仓库权限、分支基线及变更大小后重试。');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async validateBranch(branch: string) {
    if (typeof branch !== 'string' || !branch || branch !== branch.trim() || branch.length > 240 || branch.startsWith('-')) {
      throw new BadRequestException('请输入有效的 Git 分支名。');
    }
    try {
      await runGit('git', ['check-ref-format', `refs/heads/${branch}`], { timeout: 5000 });
    } catch {
      throw new BadRequestException('请输入有效的 Git 分支名，不能使用通配符或无效引用。');
    }
  }

  private async remoteEnv(remoteUrl: string, organizationId: string) {
    if (!organizationId?.trim()) throw new BadRequestException('需要明确的组织上下文来读取交付分支。');
    if (!remoteUrl.trim() || remoteUrl.startsWith('-')) throw new BadRequestException('仓库未配置有效远程地址。');
    const parsed = parseRepositoryRemote(remoteUrl);
    const token = parsed ? await this.gitCredentialsService.getAccessTokenForProvider(parsed.provider, organizationId.trim()) : null;
    return buildGitRemoteVerificationEnv(remoteUrl, token);
  }

  async verifyBranchTip(remoteUrl: string, branch: string, headSha: string): Promise<boolean> {
    const execFileAsync = promisify(execFile);
    const trimmedUrl = remoteUrl.trim();
    const trimmedBranch = branch.trim();
    const trimmedSha = headSha.trim().toLowerCase();
    if (!trimmedUrl || !trimmedBranch || !trimmedSha) {
      return false;
    }

    try {
      const parsed = parseRepositoryRemote(trimmedUrl);
      const token = parsed
        ? await this.gitCredentialsService.getAccessTokenForProvider(parsed.provider)
        : null;
      const { stdout } = await execFileAsync(
        'git',
        ['ls-remote', trimmedUrl, `refs/heads/${trimmedBranch}`],
        {
          env: buildGitRemoteVerificationEnv(trimmedUrl, token),
          maxBuffer: 1024 * 1024,
        },
      );
      const line = stdout
        .split('\n')
        .map((entry) => entry.trim())
        .find(Boolean);
      if (!line) {
        return false;
      }
      const remoteSha = line.split(/\s+/)[0]?.trim().toLowerCase();
      if (!remoteSha) {
        return false;
      }
      return compareRemoteSha(remoteSha, trimmedSha);
    } catch {
      return false;
    }
  }
}
