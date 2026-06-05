import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { collectGitReport } from './git-report.js';

const execFile = promisify(execFileCallback);

async function git(cwd: string, args: string[]) {
  await execFile('git', args, { cwd });
}

describe('collectGitReport', () => {
  it('collects branch, head sha, changed files, untracked files, and diff summary', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'flowx-mcp-git-'));
    await git(cwd, ['init']);
    await git(cwd, ['config', 'user.email', 'flowx@example.com']);
    await git(cwd, ['config', 'user.name', 'FlowX Test']);
    await writeFile(join(cwd, 'tracked.txt'), 'before\n');
    await git(cwd, ['add', 'tracked.txt']);
    await git(cwd, ['commit', '-m', 'initial']);
    await writeFile(join(cwd, 'tracked.txt'), 'after\n');
    await writeFile(join(cwd, 'new.txt'), 'new\n');

    const report = await collectGitReport(cwd);

    expect(report.branch).toBeTruthy();
    expect(report.headSha).toMatch(/^[a-f0-9]{40}$/);
    expect(report.changedFiles).toEqual(['tracked.txt']);
    expect(report.untrackedFiles).toEqual(['new.txt']);
    expect(report.diffSummary).toContain('tracked.txt');
    expect(report.dirty).toBe(true);
  }, 15_000);
});
