const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCalendarDate(isoDate: string): Date {
  const normalized = isoDate.slice(0, 10);
  if (!DATE_RE.test(normalized)) {
    throw new Error(`Invalid date: ${isoDate}`);
  }
  const [y, m, d] = normalized.split('-').map(Number);
  return new Date(y, m - 1, d);
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
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function localTodayIso(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addLocalCalendarDays(isoDate: string, days: number): string {
  const date = parseCalendarDate(isoDate);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatScheduleRange(start?: string | null, end?: string | null) {
  if (!start || !end) {
    return '未排期';
  }
  return `${start.slice(0, 10)} ~ ${end.slice(0, 10)}`;
}

export function formatAssignmentSummary(
  assignments: Array<{ user?: { displayName: string } }> | undefined,
) {
  if (!assignments || assignments.length === 0) {
    return '未排人员';
  }
  const first = assignments[0]?.user?.displayName ?? '成员';
  if (assignments.length === 1) {
    return first;
  }
  return `${first} 等 ${assignments.length} 人`;
}

export function displayEstimatedDays(assignment: {
  plannedStartDate: string;
  plannedEndDate: string;
  estimatedDays?: number;
}) {
  if (assignment.estimatedDays !== undefined && assignment.estimatedDays !== null) {
    return assignment.estimatedDays;
  }
  return countBusinessDays(assignment.plannedStartDate, assignment.plannedEndDate);
}
