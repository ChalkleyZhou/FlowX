export const DEFAULT_BRIEFING_TIMEZONE = 'Asia/Shanghai';
export const DEFAULT_BRIEFING_CUTOFF_HOUR = 22;

export function briefingLocalParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
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

export function formatBriefingDate(date: Date, timezone: string) {
  const parts = briefingLocalParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(
    2,
    '0',
  )}`;
}

export function resolveBriefingDate(now: Date, timezone: string, cutoffHour: number) {
  const parts = briefingLocalParts(now, timezone);
  if (parts.hour >= cutoffHour) {
    return formatBriefingDate(new Date(now.getTime() + 24 * 60 * 60 * 1000), timezone);
  }
  return formatBriefingDate(now, timezone);
}

export function isBriefingSchedulerDue(now: Date, timezone: string, dailyHour: number) {
  return briefingLocalParts(now, timezone).hour === dailyHour;
}

export function briefingDateWindow(date: string, timezone: string, cutoffHour: number) {
  const end = localDateTimeToUtc(date, cutoffHour, 0, 0, timezone);
  const startDate = shiftCalendarDate(date, -1);
  const start = localDateTimeToUtc(startDate, cutoffHour, 0, 0, timezone);
  return { start, end };
}

export function dateAtTimezoneMidnight(date: string, timezone: string) {
  return localDateTimeToUtc(date, 0, 0, 0, timezone);
}

function shiftCalendarDate(date: string, deltaDays: number) {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

function localDateTimeToUtc(
  date: string,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
) {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
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

  throw new Error(`Unable to resolve local time ${date} ${hour}:${minute}:${second} in ${timeZone}.`);
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
