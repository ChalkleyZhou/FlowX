import { describe, expect, it } from 'vitest';
import { countBusinessDays, formatAssignmentSummary } from './business-days';

describe('countBusinessDays', () => {
  it('counts weekdays in range', () => {
    expect(countBusinessDays('2026-05-18', '2026-05-22')).toBe(5);
  });

  it('counts Fri through Tue across a weekend', () => {
    expect(countBusinessDays('2026-05-22', '2026-05-26')).toBe(3);
  });
});

describe('formatAssignmentSummary', () => {
  it('describes multiple assignees', () => {
    expect(
      formatAssignmentSummary([
        { user: { displayName: 'Alice' } },
        { user: { displayName: 'Bob' } },
      ]),
    ).toBe('Alice 等 2 人');
  });
});
