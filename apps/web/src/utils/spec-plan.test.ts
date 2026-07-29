// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { parseSpecPlanOutput, serializeSpecPlanOutput } from './spec-plan';
import type { SpecPlanOutput } from '../types';

const sampleOutput: SpecPlanOutput = {
  spec: {
    goal: '登录后展示欢迎弹框',
    scope: ['欢迎弹框展示'],
    nonGoals: ['改登录鉴权'],
    acceptanceCriteria: ['登录成功后展示一次'],
    constraints: ['复用现有弹框组件'],
  },
  plan: {
    approach: '在 App 挂载欢迎弹框并做频控',
    touchpoints: ['apps/web/src/App.tsx'],
    sequence: ['挂载组件', '加频控', '联调'],
    risks: ['频控状态丢失'],
    verification: ['手动登录验证'],
  },
  notes: {
    checklist: ['确认文案'],
    openQuestions: [],
  },
};

describe('parseSpecPlanOutput', () => {
  it('parses structured spec/plan/notes objects from API output', () => {
    expect(parseSpecPlanOutput(sampleOutput)).toEqual(sampleOutput);
  });

  it('rejects legacy string-shaped spec/plan fields', () => {
    expect(parseSpecPlanOutput({ spec: 'legacy', plan: 'legacy' })).toBeNull();
  });

  it('round-trips through serializeSpecPlanOutput', () => {
    const serialized = serializeSpecPlanOutput(sampleOutput);
    expect(parseSpecPlanOutput(JSON.parse(serialized))).toEqual(sampleOutput);
  });
});
