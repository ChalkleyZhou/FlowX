import { describe, expect, it } from 'vitest';
import {
  buildBugFixExecutionFeedback,
  buildBugFixRequirementPayload,
  buildBugFixSpecPlan,
} from './bug-fix-workflow.bootstrap';

const bug = {
  title: '登录 500',
  description: '点击登录报错',
  expectedBehavior: '应进入首页',
  actualBehavior: '500',
  reproductionSteps: ['打开登录页', '输入账号密码', '点击登录'],
};

describe('bug-fix-workflow.bootstrap', () => {
  it('builds requirement acceptance from expected behavior', () => {
    const requirement = buildBugFixRequirementPayload(bug);
    expect(requirement.title).toBe('[BugFix] 登录 500');
    expect(requirement.acceptanceCriteria).toContain('应进入首页');
    expect(requirement.description).toContain('打开登录页');
  });

  it('builds spec plan from bug', () => {
    const specPlan = buildBugFixSpecPlan(bug);
    expect(specPlan.spec.goal).toContain('登录 500');
    expect(specPlan.spec.acceptanceCriteria).toContain('应进入首页');
    expect(specPlan.plan.sequence.length).toBeGreaterThan(0);
    expect(specPlan.plan.risks[0]).toContain('最小');
  });

  it('builds execution feedback from bug', () => {
    const feedback = buildBugFixExecutionFeedback(bug);
    expect(feedback).toContain('登录 500');
    expect(feedback).toContain('应进入首页');
  });
});
