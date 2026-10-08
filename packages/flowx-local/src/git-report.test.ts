import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { collectGitReport } from './git-report.js';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('采集已提交的分支变更，并把未提交和未跟踪文件单独标记', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'flowx-git-report-'));
  directories.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'FlowX Test');
  git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(cwd, 'base.txt'), 'base\n');
  git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'base');
  git('checkout', '-b', 'feature');
  writeFileSync(join(cwd, 'committed.txt'), 'feature\n');
  git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'feature');
  expect(await collectGitReport(cwd, 'main')).toMatchObject({ changedFiles: ['committed.txt'], dirty: false });
  writeFileSync(join(cwd, 'base.txt'), 'dirty\n');
  writeFileSync(join(cwd, 'untracked.txt'), 'untracked\n');
  expect(await collectGitReport(cwd, 'main')).toMatchObject({ changedFiles: ['committed.txt'], dirty: true, untrackedFiles: ['untracked.txt'] });
  await expect(collectGitReport(cwd, 'missing-base')).rejects.toThrow(/基线/);
});
