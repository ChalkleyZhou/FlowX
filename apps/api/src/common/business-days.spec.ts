import { describe, expect, it } from 'vitest';
import { countBusinessDays, estimateHoursFromRange } from './business-days';

describe('countBusinessDays', () => {
  it('counts Mon-Fri inclusive', () => {
    expect(countBusinessDays('2026-05-18', '2026-05-22')).toBe(5);
  });

  it('returns 0 when end before start', () => {
    expect(countBusinessDays('2026-05-22', '2026-05-18')).toBe(0);
  });

  it('skips weekend in the middle', () => {
    expect(countBusinessDays('2026-05-22', '2026-05-25')).toBe(2);
  });

  it('counts Fri through Tue across a weekend', () => {
    expect(countBusinessDays('2026-05-22', '2026-05-26')).toBe(3);
  });
});

describe('estimateHoursFromRange', () => {
  it('multiplies business days by 8', () => {
    expect(estimateHoursFromRange('2026-05-18', '2026-05-22')).toBe(40);
  });
});
