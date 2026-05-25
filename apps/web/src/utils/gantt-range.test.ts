import { describe, expect, it } from 'vitest';
import {
  barGridSpan,
  clipRangeToWindow,
  dayHeaderLabel,
  enumerateDays,
  isWeekendUtc,
  monthRange,
  shiftMonth,
} from './gantt-range';

describe('gantt-range', () => {
  it('enumerates inclusive calendar days', () => {
    expect(enumerateDays('2026-05-01', '2026-05-03')).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
    ]);
  });

  it('detects weekend days', () => {
    expect(isWeekendUtc('2026-05-23')).toBe(true);
    expect(isWeekendUtc('2026-05-22')).toBe(false);
  });

  it('clips bar dates to window', () => {
    expect(
      clipRangeToWindow('2026-04-28', '2026-05-05', { from: '2026-05-01', to: '2026-05-31' }),
    ).toEqual({ start: '2026-05-01', end: '2026-05-05' });
  });

  it('computes grid span for bar within month', () => {
    const range = monthRange(new Date('2026-05-15T00:00:00.000Z'));
    expect(barGridSpan('2026-05-05', '2026-05-07', range)).toEqual({ startCol: 5, endCol: 8 });
  });

  it('shifts month range', () => {
    const may = monthRange(new Date('2026-05-15T00:00:00.000Z'));
    const june = shiftMonth(may.from, 1);
    expect(june.from).toBe('2026-06-01');
    expect(june.to).toBe('2026-06-30');
  });

  it('formats day header with weekday', () => {
    expect(dayHeaderLabel('2026-05-22')).toMatch(/22/);
  });
});
