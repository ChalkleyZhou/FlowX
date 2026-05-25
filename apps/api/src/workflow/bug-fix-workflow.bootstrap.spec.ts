import { describe, expect, it } from 'vitest';
import {
  buildBugFixExecutionFeedback,
  buildBugFixPlanContent,
  buildBugFixRequirementPayload,
  buildBugFixTask,
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

  it('builds single confirmed task from bug', () => {
    const task = buildBugFixTask(bug, ['flowx-web']);
    expect(task.title).toBe('登录 500');
    expect(task.description).toContain('打开登录页');
    expect(task.repositoryNames).toEqual(['flowx-web']);
  });

  it('builds plan content from bug', () => {
    const plan = buildBugFixPlanContent(bug);
    expect(plan.summary).toContain('登录 500');
    expect(plan.implementationPlan.length).toBeGreaterThan(0);
  });

  it('builds execution feedback from bug', () => {
    const feedback = buildBugFixExecutionFeedback(bug);
    expect(feedback).toContain('登录 500');
    expect(feedback).toContain('应进入首页');
  });
});
