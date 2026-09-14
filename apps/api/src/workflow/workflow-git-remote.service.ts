import { Injectable } from '@nestjs/common';
import { GitCredentialsService } from '../auth/git-credentials.service';
import { parseRepositoryRemote } from '../briefings/repository-remote';
import { buildGitAuthEnv, resolveGitRemoteAuth } from '../workspaces/git-remote-auth';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
