import { describe, expect, it, vi } from 'vitest';
import { runLaunch } from './launch.js';
const redeemed = {
  purpose: 'quality-test', apiBaseUrl: 'https://flowx.example', testRunId: 'test-run-1', executionSessionId: 'session-1',
  repositories: [{ workflowRepositoryId: 'wr-1', url: 'https://github.com/org/repo.git', branch: 'feature', headSha: 'abc' }],
  handoff: { testRunId: 'test-run-1', executionSessionId: 'session-1', testRunRevision: 1, sourceFingerprint: 'fp', cases: [{ id: 'case-1' }], target: { id: 'target-1' } },
  chatPrompt: '实际执行测试', mcpToken: 'short-token', mcpTokenExpiresAt: '2099-01-01T00:00:00Z',
};
const request = { ticket: 'ticket-1', ide: 'codex' as const, apiBaseUrl: 'https://flowx.example', purpose: 'quality-test' as const };
function fixture() {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => redeemed }));
  const launch = vi.fn(async () => ({ ok: true as const, opened: true, prefilled: false, gitRoot: '/repo', ide: 'codex' as const, promptPath: '/repo/prompt.md', testRunId: 'test-run-1', executionSessionId: 'session-1' }));
  const dependencies = { fetch, deviceId: 'device-1', resolveRepoPath: vi.fn(async () => '/repo'), collectRepositoryState: vi.fn(async () => ({ branch: 'feature', headSha: 'abc', dirty: false, remoteUrl: 'git@github.com:org/repo.git' })), registry: { resolve: vi.fn(() => ({ name: 'codex', capabilities: [], launch })) } };
  return { fetch, launch, dependencies };
}
describe('质量测试 IDE 启动', () => {
  it('使用设备兑换、校验仓库基线后传入独立测试身份，打开IDE不回传通过', async () => {
    const f = fixture();
    expect(await runLaunch(request, f.dependencies)).toMatchObject({ purpose: 'quality-test', testRunId: 'test-run-1', opened: true });
    expect(f.fetch).toHaveBeenCalledWith('https://flowx.example/quality/local-launch/redeem', expect.objectContaining({ body: JSON.stringify({ ticket: 'ticket-1', deviceId: 'device-1' }) }));
    expect(f.launch).toHaveBeenCalledWith(expect.objectContaining({ testRunId: 'test-run-1', stage: 'quality-test', executionSessionId: 'session-1' }));
    expect(f.launch.mock.calls[0]?.[0]).not.toHaveProperty('workflowRunId');
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['branch', 'headSha', 'dirty', 'remoteUrl'] as const)('%s 不匹配时释放，不打开IDE', async field => {
    const f = fixture();
    f.dependencies.collectRepositoryState.mockResolvedValue({ branch: 'feature', headSha: 'abc', dirty: false, remoteUrl: 'https://github.com/org/repo.git', [field]: field === 'dirty' ? true : 'other' });
    await expect(runLaunch(request, f.dependencies)).rejects.toThrow();
    expect(f.launch).not.toHaveBeenCalled();
    expect(f.fetch).toHaveBeenLastCalledWith('https://flowx.example/execution-sessions/session-1/quality/release', expect.objectContaining({ headers: { 'content-type': 'application/json', authorization: 'Bearer short-token' } }));
  });
  it.each(['mapping', 'adapter', 'not-opened'])('%s 失败时释放领取', async mode => {
    const f = fixture();
    if (mode === 'mapping') f.dependencies.resolveRepoPath.mockRejectedValue(new Error('cancelled'));
    else if (mode === 'adapter') f.launch.mockRejectedValue(new Error('IDE failed'));
    else f.launch.mockResolvedValue({ ok: true, opened: false } as never);
    await expect(runLaunch(request, f.dependencies)).rejects.toThrow();
    expect(f.fetch.mock.calls.some(([url]) => url.endsWith('/quality/release'))).toBe(true);
  });
  it('所有仓库通过验证才打开IDE，不能只校验第一个仓库', async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...redeemed, repositories: [...redeemed.repositories, { workflowRepositoryId: 'wr-2', url: 'https://github.com/org/second.git', branch: 'feature', headSha: 'abc' }] }) } as never);
    await expect(runLaunch(request, f.dependencies)).rejects.toThrow();
    expect(f.dependencies.collectRepositoryState).toHaveBeenCalledTimes(2);
    expect(f.launch).not.toHaveBeenCalled();
  });
});
it('服务端返回不完整但已有领取会话时，释放该会话', async () => {
  const f = fixture();
  f.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...redeemed, repositories: [] }) } as never);
  await expect(runLaunch(request, f.dependencies)).rejects.toThrow();
  expect(f.fetch.mock.calls.some(([url]) => url.endsWith('/quality/release'))).toBe(true);
});
it('真实 Git 仓库按 remote、分支和提交校验，未提交变更拒绝交接并释放', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'quality-launch-git-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-b', 'feature'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
    writeFileSync(join(root, 'case.txt'), 'ready'); git('add', '.'); git('commit', '-m', 'test fixture');
    git('remote', 'add', 'origin', 'https://github.com/org/repo.git');
    const payload = { ...redeemed, repositories: [{ ...redeemed.repositories[0], headSha: git('rev-parse', 'HEAD') }] };
    const send = vi.fn(async () => ({ ok: true, json: async () => payload }));
    const dependencies = { fetch: send, deviceId: 'device', resolveRepoPath: async () => root, ensureProject: vi.fn(), writePromptFile: vi.fn(() => '/prompt'), openIde: vi.fn(async () => ({ opened: true, prefilled: false })) };
    await expect(runLaunch(request, dependencies)).resolves.toMatchObject({ testRunId: 'test-run-1', opened: true });
    mkdirSync(join(root, '.cursor'), { recursive: true });
    mkdirSync(join(root, '.flowx', 'tasks'), { recursive: true });
    writeFileSync(join(root, '.cursor', 'mcp.json'), '{}');
    writeFileSync(join(root, '.flowx', 'tasks', 'test-run-1.md'), '交接');
    await expect(runLaunch(request, dependencies)).resolves.toMatchObject({ opened: true });
    writeFileSync(join(root, '.flowx', 'tasks', 'unknown.md'), '未知文档');
    await expect(runLaunch(request, dependencies)).rejects.toThrow('代码基线');
    rmSync(join(root, '.flowx', 'tasks', 'unknown.md'));
    writeFileSync(join(root, '.cursor', 'business.json'), '业务文件');
    await expect(runLaunch(request, dependencies)).rejects.toThrow('代码基线');
    rmSync(join(root, '.cursor', 'business.json'));
    git('add', '.cursor/mcp.json'); git('commit', '-m', 'track config');
    payload.repositories[0].headSha = git('rev-parse', 'HEAD');
    writeFileSync(join(root, '.cursor', 'mcp.json'), '{"changed":true}');
    await expect(runLaunch(request, dependencies)).rejects.toThrow('代码基线');
    git('restore', '.cursor/mcp.json');
    writeFileSync(join(root, 'case.txt'), 'dirty');
    await expect(runLaunch(request, dependencies)).rejects.toThrow('代码基线');
    expect(send.mock.calls.some(([url]) => url.endsWith('/quality/release'))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
