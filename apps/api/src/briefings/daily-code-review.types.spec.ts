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
});
