import { describe, expect, it } from 'vitest';
import { MockAiExecutor } from './mock-ai.executor';
import type { GenerateDesignInput, GenerateSpecPlanInput } from '../common/types';

const input: GenerateDesignInput = {
  requirementTitle: '通知中心',
  requirementDescription: '集中查看与管理站内通知',
  confirmedBrief: {
    expandedDescription: '通知中心',
    userStories: [],
    edgeCases: [],
    successMetrics: [],
    openQuestions: [],
    assumptions: [],
    outOfScope: [],
  },
};

describe('MockAiExecutor.generateDesign', () => {
  it('returns surfaces with self-contained HTML (no demoPages) in the design phase', async () => {
    const executor = new MockAiExecutor();
    const out = await executor.generateDesign(input, undefined, { phase: 'design' });

    expect(out.surfaces?.[0]?.id).toBe('Web端');
    expect(out.surfaces?.[0]?.pages?.[0]?.html).toContain('<!doctype html>');
    expect(out.surfaces?.[0]?.pages?.[0]?.html).toContain('通知中心');
    expect(out.demoPages).toHaveLength(0);
    expect(out.design.overview).toBeTruthy();
  });

  it('still returns runnable demoPages in the default (demo) phase', async () => {
    const executor = new MockAiExecutor();
    const out = await executor.generateDesign(input);

    expect(out.demoPages.length).toBeGreaterThanOrEqual(2);
    expect(out.surfaces).toBeUndefined();
  });
});

describe('MockAiExecutor.generateSpecPlan', () => {
  it('returns Spec&Plan shaped output from the requirement title', async () => {
    const executor = new MockAiExecutor();
    const specInput: GenerateSpecPlanInput = {
      requirement: {
        id: 'req-1',
        title: '通知中心',
        description: '集中查看与管理站内通知',
        acceptanceCriteria: '可查看未读通知',
      },
    };

    const out = await executor.generateSpecPlan(specInput);

    expect(out.spec.goal).toBe('通知中心');
    expect(out.spec.scope.length).toBeGreaterThan(0);
    expect(out.plan.approach).toBeTruthy();
    expect(out.plan.sequence).toEqual(['阅读 Spec', '实现', '本地验证']);
    expect(out.notes).toEqual({ checklist: [], openQuestions: [] });
  });
});
