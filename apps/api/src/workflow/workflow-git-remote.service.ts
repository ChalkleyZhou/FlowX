import { Injectable } from '@nestjs/common';
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

@Injectable()
export class WorkflowGitRemoteService {
  async verifyBranchTip(remoteUrl: string, branch: string, headSha: string): Promise<boolean> {
    const execFileAsync = promisify(execFile);
    const trimmedUrl = remoteUrl.trim();
    const trimmedBranch = branch.trim();
    const trimmedSha = headSha.trim().toLowerCase();
    if (!trimmedUrl || !trimmedBranch || !trimmedSha) {
      return false;
    }

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-remote', trimmedUrl, `refs/heads/${trimmedBranch}`],
        { maxBuffer: 1024 * 1024 },
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
