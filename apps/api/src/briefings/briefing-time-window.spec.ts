import { describe, expect, it } from 'vitest';
import {
  briefingDateWindow,
  formatBriefingDate,
  isBriefingSchedulerDue,
  resolveBriefingDate,
} from './briefing-time-window';

describe('briefing-time-window', () => {
  it('uses a Beijing cutoff-hour window so late-night events roll into the next briefing date', () => {
    const { start, end } = briefingDateWindow('2026-06-05', 22);

    expect(start.toISOString()).toBe('2026-06-04T14:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-05T14:00:00.000Z');
  });

  it('resolves the current briefing date after the cutoff hour in Beijing time', () => {
    expect(resolveBriefingDate(new Date('2026-06-04T15:30:00.000Z'), 22)).toBe('2026-06-05');
    expect(resolveBriefingDate(new Date('2026-06-05T12:00:00.000Z'), 22)).toBe('2026-06-05');
  });

  it('formats the scheduler date in Beijing time', () => {
    expect(formatBriefingDate(new Date('2026-06-05T14:30:00.000Z'))).toBe('2026-06-05');
  });

  it('marks the scheduler due only during the configured Beijing hour', () => {
    expect(isBriefingSchedulerDue(new Date('2026-06-05T14:30:00.000Z'), 22)).toBe(true);
    expect(isBriefingSchedulerDue(new Date('2026-06-05T12:00:00.000Z'), 22)).toBe(false);
  });
});
