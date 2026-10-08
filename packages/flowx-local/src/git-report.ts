import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

function lines(value: string) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

export async function collectGitReport(cwd: string, baseBranch?: string) {
  let base: string | undefined;
  if (baseBranch) {
    // 使用明确的引用命名空间，避免分支名被当成 Git 参数。
    for (const ref of [`refs/remotes/origin/${baseBranch}`, `refs/heads/${baseBranch}`]) {
      try { base = await git(cwd, ['merge-base', 'HEAD', ref]); break; } catch { /* 尝试本地基线 */ }
    }
    if (!base) throw new Error('找不到任务基线分支，请先获取远程基线后重试。');
  }
  const diffRange = base ? [base, 'HEAD'] : ['HEAD'];
  const [branch, headSha, changedText, untrackedText, diffSummary, statusText] = await Promise.all([
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['rev-parse', 'HEAD']),
    git(cwd, ['diff', '--name-only', ...diffRange, '--']),
    git(cwd, ['ls-files', '--others', '--exclude-standard']),
    git(cwd, ['diff', '--stat', ...diffRange, '--']),
    git(cwd, ['status', '--porcelain']),
  ]);

  return {
    branch,
    headSha,
    changedFiles: lines(changedText),
    untrackedFiles: lines(untrackedText),
    diffSummary,
    dirty: statusText.length > 0,
  };
}
