import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { isQualityLocalLaunchRedeemed } from '@flowx-ai/protocol';
import { ensureDeviceIdentity } from './device.js';
import { normalizeRepoUrl } from './config.js';
import { collectGitReport } from './git-report.js';
import type { LaunchDependencies, LaunchRequest } from './launch.js';
import { resolveRepoPath } from './repo-map.js';
export type RepositoryState = { branch: string; headSha: string; dirty: boolean; remoteUrl: string };
const execFile = promisify(execFileCallback);
export async function collectRepositoryState(cwd: string, options?: { testRunId: string }): Promise<RepositoryState> {
  const [report, remote, status] = await Promise.all([
    collectGitReport(cwd),
    execFile('git', ['remote', 'get-url', 'origin'], { cwd }),
    execFile('git', ['status', '--porcelain=v1', '--untracked-files=all', '-z'], { cwd }),
  ]);
  // 只排除本工具明确生成的未跟踪文件，已跟踪配置改动和目录内其他业务文件仍拒绝。
  const generatedPaths = new Set(['.cursor/mcp.json', '.workbuddy/mcp.json', ...(options?.testRunId ? [`.flowx/tasks/${options.testRunId}.md`] : [])]);
  const dirty = status.stdout.split('\0').filter(Boolean).some(entry => !entry.startsWith('?? ') || !generatedPaths.has(entry.slice(3)));
  return { branch: report.branch, headSha: report.headSha, dirty, remoteUrl: remote.stdout.trim() };
}
function repositoryKey(url: string) {
  const scp = /^([^/@]+@)?([^/:]+):(.+)$/.exec(url);
  const normalized = normalizeRepoUrl(scp && !url.includes('://') ? `https://${scp[2]}/${scp[3]}` : url);
  return normalized.replace(/^[^:]+:\/\//, '');
}
export async function runQualityLaunch(request: LaunchRequest, dependencies: LaunchDependencies & { registry: NonNullable<LaunchDependencies['registry']> }) {
  const send = dependencies.fetch ?? fetch;
  const apiBaseUrl = request.apiBaseUrl.trim().replace(/\/+$/, '');
  const deviceId = dependencies.deviceId ?? ensureDeviceIdentity({ homeDir: dependencies.homeDir }).deviceId;
  const response = await send(`${apiBaseUrl}/quality/local-launch/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: request.ticket, deviceId }) });
  if (!response.ok || !response.json) throw Object.assign(new Error('质量测试启动票据兑换失败，请重新启动。'), { code: 'REDEEM_FAILED' });
  const redeemed: unknown = await response.json();
  try {
    if (!isQualityLocalLaunchRedeemed(redeemed)) throw Object.assign(new Error('质量测试启动响应缺少会话或代码基线，请升级服务端和本地包后重试。'), { code: 'REDEEM_FAILED' });
    const roots: string[] = [];
    for (const repository of redeemed.repositories) {
      const root = await (dependencies.resolveRepoPath ?? resolveRepoPath)(repository.url);
      const state = await (dependencies.collectRepositoryState ?? collectRepositoryState)(root, { testRunId: redeemed.testRunId });
      if (state.branch !== repository.branch || state.headSha.toLowerCase() !== repository.headSha.toLowerCase() || state.dirty || repositoryKey(state.remoteUrl) !== repositoryKey(repository.url)) throw new Error('本地仓库、分支、HEAD 或工作区不符合测试代码基线，请准备正确版本后重新启动。');
      roots.push(root);
    }
    const result = await dependencies.registry.resolve(request.ide).launch({ gitRoot: roots[0]!, testRunId: redeemed.testRunId, executionSessionId: redeemed.executionSessionId, stage: 'quality-test', chatPrompt: `${redeemed.chatPrompt}\n\n## 已验证本地仓库\n${redeemed.repositories.map((repo, index) => `${repo.workflowRepositoryId}: ${roots[index]} (${repo.branch}@${repo.headSha})`).join('\n')}`, apiBaseUrl, mcpToken: redeemed.mcpToken });
    if (!result.opened) throw new Error('IDE 未能打开，已释放本次领取，请修复 IDE 启动配置后重试。');
    return { ...result, purpose: 'quality-test' as const, testRunId: redeemed.testRunId };
  } catch (error) {
    // 即使响应契约不完整，只要能识别已领取身份，就释放它。
    if (!redeemed || typeof redeemed !== 'object') throw error;
    const session = redeemed as Record<string, unknown>;
    if (typeof session.executionSessionId !== 'string' || !session.executionSessionId.trim() || typeof session.mcpToken !== 'string' || !session.mcpToken.trim()) throw error;
    try {
      const released = await send(`${apiBaseUrl}/execution-sessions/${encodeURIComponent(session.executionSessionId)}/quality/release`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.mcpToken}` }, body: JSON.stringify({ reason: '本地仓库映射、基线检查或 IDE 启动失败。' }) });
      if (!released.ok) throw new Error('release rejected');
    } catch {
      throw new Error('本地启动失败，且释放租约未成功。请在 FlowX 中取消该会话或等待租约到期后重试。', { cause: error });
    }
    throw error;
  }
}
