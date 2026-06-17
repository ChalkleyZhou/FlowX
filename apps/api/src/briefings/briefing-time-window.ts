/** Briefing schedules and day boundaries always use China Standard Time (UTC+8). */
export const BRIEFING_TIMEZONE = 'Asia/Shanghai';
export const DEFAULT_BRIEFING_CUTOFF_HOUR = 22;

export function briefingLocalParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRIEFING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
  };
}

export function formatBriefingDate(date: Date) {
  const parts = briefingLocalParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(
    2,
    '0',
  )}`;
}

export function resolveBriefingDate(now: Date, cutoffHour: number) {
  const parts = briefingLocalParts(now);
  if (parts.hour >= cutoffHour) {
    return formatBriefingDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  }
  return formatBriefingDate(now);
}

export function isBriefingSchedulerDue(now: Date, dailyHour: number) {
  return briefingLocalParts(now).hour === dailyHour;
}

export function briefingDateWindow(date: string, cutoffHour: number) {
  const end = beijingLocalDateTimeToUtc(date, cutoffHour, 0, 0);
  const startDate = shiftCalendarDate(date, -1);
  const start = beijingLocalDateTimeToUtc(startDate, cutoffHour, 0, 0);
  return { start, end };
}

export function briefingWeekWindow(date: string) {
  const startDate = startOfBeijingNaturalWeek(date);
  const endDate = shiftCalendarDate(startDate, 6);
  return {
    start: beijingLocalDateTimeToUtc(startDate, 0, 0, 0),
    end: beijingLocalDateTimeToUtc(shiftCalendarDate(startDate, 7), 0, 0, 0),
    startDate,
    endDate,
  };
}

export function dateAtBeijingMidnight(date: string) {
  return beijingLocalDateTimeToUtc(date, 0, 0, 0);
}

function startOfBeijingNaturalWeek(date: string) {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utcDate.getUTCDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return shiftCalendarDate(date, -daysSinceMonday);
}

function shiftCalendarDate(date: string, deltaDays: number) {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

function beijingLocalDateTimeToUtc(date: string, hour: number, minute: number, second: number) {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BRIEFING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 1) {
    const candidate = new Date(utcGuess - offsetMinutes * 60_000);
    const parts = readLocalDateTimeParts(formatter.formatToParts(candidate));
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute &&
      parts.second === second
    ) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to resolve Beijing local time ${date} ${hour}:${minute}:${second}.`,
  );
}

function readLocalDateTimeParts(parts: Intl.DateTimeFormatPart[]) {
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** @deprecated Use BRIEFING_TIMEZONE */
export const DEFAULT_BRIEFING_TIMEZONE = BRIEFING_TIMEZONE;
