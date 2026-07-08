import { describe, expect, it } from 'vitest';
import { coerceStringArray, normalizeReviewFindings } from './daily-code-review.types';

describe('daily-code-review.types', () => {
  it('coerces string findings into single-item arrays', () => {
    expect(coerceStringArray('Add tests for scheduler')).toEqual(['Add tests for scheduler']);
  });

  it('normalizes mixed AI output shapes', () => {
    expect(
      normalizeReviewFindings({
        issues: ['one'],
        suggestions: 'Use repository conventions',
        impactScope: null,
      }),
    ).toEqual({
      issues: ['one'],
      bugs: [],
      missingTests: [],
      suggestions: ['Use repository conventions'],
      impactScope: [],
    });
  });

  it('stringifies object findings into readable text instead of [object Object]', () => {
    expect(
      coerceStringArray([
        { title: '边界缺失', description: '未处理空仓库场景' },
        { message: '可能导致空指针' },
        { summary: '补充集成测试' },
        'Keep skill in repo',
      ]),
    ).toEqual([
      '边界缺失：未处理空仓库场景',
      '可能导致空指针',
      '补充集成测试',
      'Keep skill in repo',
    ]);

    expect(coerceStringArray([{ severity: 'high', file: 'a.ts' }])).toEqual(['high；a.ts']);
    expect(String({ title: 'x' })).toBe('[object Object]');
  });
});
