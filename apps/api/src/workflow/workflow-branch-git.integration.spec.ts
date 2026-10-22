import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkflowGitRemoteService } from './workflow-git-remote.service';

const directory = mkdtempSync(join(tmpdir(), 'flowx-branch-git-test-'));
const remote = join(directory, 'remote.git');
const checkout = join(directory, 'checkout');
const service = new WorkflowGitRemoteService({ getAccessTokenForProvider: async () => null } as never);
const git = (...args: string[]) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let headSha: string;
let baseSha: string;

beforeAll(() => {
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  execFileSync('git', ['clone', remote, checkout], { stdio: 'ignore' });
  git('config', 'user.name', 'FlowX Test'); git('config', 'user.email', 'test@flowx.invalid');
  writeFileSync(join(checkout, 'README.md'), '共享基线\n');
  git('add', '.'); git('commit', '-m', 'baseline'); git('push', 'origin', 'main');
  baseSha = git('rev-parse', 'HEAD');
  git('checkout', '-b', 'feature/web');
  writeFileSync(join(checkout, 'web.ts'), 'export const notification = true;\n');
  git('add', '.'); git('commit', '-m', 'web change'); git('push', 'origin', 'feature/web');
  headSha = git('rev-parse', 'HEAD');
  // 基线后续有无关修改，交付 diff 仍应以共同祖先比较，不混入删除基线新文件。
  git('checkout', 'main');
  writeFileSync(join(checkout, 'unrelated.txt'), '其他需求\n');
  git('add', '.'); git('commit', '-m', 'unrelated'); git('push', 'origin', 'main');
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('分支交付的真实 Git 读取', () => {
  it('通过 HTTP 读取和确认时均使用明确组织的凭据', async () => {
    execFileSync('git', ['--git-dir', remote, 'update-server-info']);
    const headers: Array<string | undefined> = [];
    const server = createServer(async (request, response) => {
      headers.push(request.headers['private-token'] as string | undefined);
      const file = new URL(request.url!, 'http://localhost').pathname.replace(/^\/org\/repo\.git\//, '');
      if (file.includes('..') || file.startsWith('/')) { response.writeHead(404).end(); return; }
      try { response.end(await readFile(join(remote, file))); } catch { response.writeHead(404).end(); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('缺少测试服务地址');
      const url = `http://127.0.0.1:${address.port}/org/repo.git`;
      const getAccessTokenForProvider = vi.fn(async (_provider: string, organizationId: string) => `glpat-${organizationId}`);
      const scoped = new WorkflowGitRemoteService({ getAccessTokenForProvider } as never);
      expect(await scoped.resolveBranchHead(url, 'feature/web', 'org-a')).toBe(headSha);
      expect((await scoped.inspectBranch(url, 'main', 'feature/web', headSha, 'org-a')).headSha).toBe(headSha);
      expect(getAccessTokenForProvider).toHaveBeenNthCalledWith(1, 'gitlab', 'org-a');
      expect(getAccessTokenForProvider).toHaveBeenNthCalledWith(2, 'gitlab', 'org-a');
      expect(headers.length).toBeGreaterThan(1);
      expect(headers.every(header => header === 'glpat-org-a')).toBe(true);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it('从远端取得完整提交，不切换开发者工作目录', async () => {
    expect(await service.resolveBranchHead(remote, 'feature/web', 'org-test')).toBe(headSha);
    expect(git('branch', '--show-current')).toBe('main');
  });

  it('冻结共同基线及真实差异，忽略基线的无关新提交', async () => {
    const result = await service.inspectBranch(remote, 'main', 'feature/web', headSha, 'org-test');
    expect(result).toMatchObject({ headSha, baseSha, changedFiles: ['web.ts'] });
    expect(result.diffText).toContain('+export const notification = true;');
    expect(result.diffText).not.toContain('unrelated.txt');
    expect(result.diffStat).toContain('web.ts');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('拒绝不存在分支并隐藏原始 Git 错误', async () => {
    await expect(service.resolveBranchHead(remote, 'missing', 'org-test')).rejects.toMatchObject({ status: 400 });
    await expect(service.resolveBranchHead('/unreadable/secret-repository', 'main', 'org-test')).rejects.toMatchObject({
      message: expect.not.stringContaining('secret-repository'),
    });
  });

  it.each(['--upload-pack=other', 'feature/*', 'refs/heads/main\nother', 'main..other'])('拒绝无效分支 %s', async (branch) => {
    await expect(service.resolveBranchHead(remote, branch, 'org-test')).rejects.toMatchObject({ status: 400 });
  });

  it('确认时发现分支版本变化则拒绝，不能改为最新 SHA 后静默确认', async () => {
    await expect(service.inspectBranch(remote, 'main', 'feature/web', '0'.repeat(40), 'org-test')).rejects.toMatchObject({ status: 409 });
  });

  it('没有实际代码差异不能产生已交付结论', async () => {
    const main = await service.resolveBranchHead(remote, 'main', 'org-test');
    await expect(service.inspectBranch(remote, 'main', 'main', main, 'org-test')).rejects.toMatchObject({ status: 400 });
  });
});
