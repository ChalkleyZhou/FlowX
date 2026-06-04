import { describe, expect, it } from 'vitest';
import {
  briefingDateWindow,
  formatBriefingDate,
  isBriefingSchedulerDue,
  resolveBriefingDate,
} from './briefing-time-window';

describe('briefing-time-window', () => {
  it('uses a cutoff-hour window so late-night events roll into the next briefing date', () => {
    const { start, end } = briefingDateWindow('2026-06-05', 'Asia/Shanghai', 22);

    expect(start.toISOString()).toBe('2026-06-04T14:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-05T14:00:00.000Z');
  });

  it('resolves the current briefing date after the cutoff hour', () => {
    expect(
      resolveBriefingDate(new Date('2026-06-04T15:30:00.000Z'), 'Asia/Shanghai', 22),
    ).toBe('2026-06-05');
    expect(
      resolveBriefingDate(new Date('2026-06-05T12:00:00.000Z'), 'Asia/Shanghai', 22),
    ).toBe('2026-06-05');
  });

  it('formats the scheduler date in the configured timezone', () => {
    expect(formatBriefingDate(new Date('2026-06-05T14:30:00.000Z'), 'Asia/Shanghai')).toBe(
      '2026-06-05',
    );
  });

  it('marks the scheduler due only during the configured local hour', () => {
    expect(
      isBriefingSchedulerDue(new Date('2026-06-05T14:30:00.000Z'), 'Asia/Shanghai', 22),
    ).toBe(true);
    expect(
      isBriefingSchedulerDue(new Date('2026-06-05T12:00:00.000Z'), 'Asia/Shanghai', 22),
    ).toBe(false);
  });
});
