import { describe, expect, it } from 'vitest';
import { formatBeijingDateTime } from './datetime';

describe('formatBeijingDateTime', () => {
  it('formats UTC timestamps in Beijing time', () => {
    expect(formatBeijingDateTime('2026-06-05T14:30:00.000Z')).toBe('2026/06/05 22:30:00');
  });

  it('returns a dash for empty values', () => {
    expect(formatBeijingDateTime(null)).toBe('-');
  });
});
