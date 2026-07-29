import { describe, expect, it } from 'vitest';
import { MockAiExecutor } from './mock-ai.executor';
import type { GenerateDesignInput } from '../common/types';

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
