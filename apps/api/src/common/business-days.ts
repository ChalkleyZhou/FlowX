const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse YYYY-MM-DD as local calendar date (matches browser date inputs). */
export function parseCalendarDate(isoDate: string): Date {
  if (!DATE_RE.test(isoDate)) {
    throw new Error(`Invalid date: ${isoDate}`);
  }
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Format Date as YYYY-MM-DD using local calendar components. */
export function formatCalendarDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

export function countBusinessDays(start: string, end: string): number {
  const from = parseCalendarDate(start);
  const to = parseCalendarDate(end);
  if (to < from) {
    return 0;
  }

  let count = 0;
  const cursor = new Date(from);
  while (cursor <= to) {
    if (isWeekday(cursor)) {
      count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function estimateHoursFromRange(start: string, end: string): number {
  return countBusinessDays(start, end) * 8;
}

/** @deprecated Use formatCalendarDate */
export function formatUtcDate(date: Date): string {
  return formatCalendarDate(date);
}

export function parseAssignmentDate(isoDate: string): Date {
  return parseCalendarDate(isoDate);
}
