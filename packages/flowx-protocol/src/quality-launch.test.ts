import { describe, expect, it } from 'vitest';
import { isQualityLocalLaunchRedeemed } from './quality-launch.js';
describe('质量启动协议校验', () => {
  const value = { purpose: 'quality-test', apiBaseUrl: 'https://flowx.example', testRunId: 'run-1', executionSessionId: 'session-1', mcpToken: 'token', mcpTokenExpiresAt: '2099-01-01', chatPrompt: '执行', repositories: [{ workflowRepositoryId: 'wr-1', url: 'https://github.com/org/repo.git', branch: 'main', headSha: 'abc' }] };
  it('接受完整启动数据，拒绝缺失基线/身份/空仓库列表', () => {
    expect(isQualityLocalLaunchRedeemed(value)).toBe(true);
    expect(isQualityLocalLaunchRedeemed({ ...value, repositories: [] })).toBe(false);
    expect(isQualityLocalLaunchRedeemed({ ...value, executionSessionId: '' })).toBe(false);
    expect(isQualityLocalLaunchRedeemed({ ...value, repositories: [{ ...value.repositories[0], headSha: undefined }] })).toBe(false);
    expect(isQualityLocalLaunchRedeemed(null)).toBe(false);
  });
});
