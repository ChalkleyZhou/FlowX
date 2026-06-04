import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFile('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

function lines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function collectGitReport(cwd: string) {
  const [branch, headSha, changedText, untrackedText, diffSummary, statusText] = await Promise.all([
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['rev-parse', 'HEAD']),
    git(cwd, ['diff', '--name-only', 'HEAD']),
    git(cwd, ['ls-files', '--others', '--exclude-standard']),
    git(cwd, ['diff', '--stat', 'HEAD']),
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
