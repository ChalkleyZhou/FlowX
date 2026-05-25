/** Calendar-day helpers for schedule gantt (UTC date strings YYYY-MM-DD). */

export function parseGanttDate(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

export function monthRange(reference = new Date()): { from: string; to: string } {
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
  const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export function shiftMonth(from: string, deltaMonths: number): { from: string; to: string } {
  const anchor = new Date(`${from}T00:00:00.000Z`);
  anchor.setUTCMonth(anchor.getUTCMonth() + deltaMonths);
  return monthRange(anchor);
}

export function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const endMs = parseGanttDate(to);
  while (cursor.getTime() <= endMs) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function isWeekendUtc(date: string): boolean {
  const dow = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

export function clipRangeToWindow(
  start: string,
  end: string,
  window: { from: string; to: string },
): { start: string; end: string } {
  return {
    start: start < window.from ? window.from : start,
    end: end > window.to ? window.to : end,
  };
}

/** Inclusive 1-based grid column span within [from, to]. */
export function barGridSpan(
  start: string,
  end: string,
  range: { from: string; to: string },
): { startCol: number; endCol: number } {
  const days = enumerateDays(range.from, range.to);
  const startIdx = days.indexOf(start);
  const endIdx = days.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    return { startCol: 1, endCol: 1 };
  }
  return { startCol: startIdx + 1, endCol: endIdx + 2 };
}

export function formatMonthLabel(from: string): string {
  const d = new Date(`${from}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
}

export function formatRangeLabel(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return formatMonthLabel(from);
  }
  return `${from} ~ ${to}`;
}

export function dayHeaderLabel(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  const day = d.getUTCDate();
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'narrow', timeZone: 'UTC' }).format(d);
  return `${weekday}${day}`;
}
