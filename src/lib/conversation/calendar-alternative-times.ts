import 'server-only';

import { getGoogleCalendarBusyTimes } from '../google/calendar';
import {
  addCivilDays,
  getCivilDateInTimeZone,
  isValidTimeZone,
  resolveCivilDateTimeInTimeZone,
} from './timezone';

export type CalendarAlternativeTime = {
  hour: number;
  minute: 0;
  label: string;
};

export type CalendarAlternativeTimesResult =
  | { status: 'ok'; suggestions: CalendarAlternativeTime[] }
  | { status: 'unavailable' }
  | { status: 'invalid_timezone' };

function overlaps(startMs: number, endMs: number, busyStart: string, busyEnd: string): boolean {
  const busyStartMs = Date.parse(busyStart);
  const busyEndMs = Date.parse(busyEnd);
  if (!Number.isFinite(busyStartMs) || !Number.isFinite(busyEndMs)) return true;
  return startMs < busyEndMs && endMs > busyStartMs;
}

export async function suggestCalendarAlternativeTimes(
  timeZone: string,
  now: number,
  requestedHour: number,
): Promise<CalendarAlternativeTimesResult> {
  if (!isValidTimeZone(timeZone) || !Number.isSafeInteger(now)) {
    return { status: 'invalid_timezone' };
  }
  if (!Number.isInteger(requestedHour) || requestedHour < 0 || requestedHour > 23) {
    return { status: 'invalid_timezone' };
  }

  const today = getCivilDateInTimeZone(new Date(now), timeZone);
  const tomorrow = addCivilDays(today, 1);
  const currentCivilHour = Number(
    new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone }).format(new Date(now)),
  );
  const firstHour = Math.max(requestedHour + 1, currentCivilHour + 1, 7);
  if (firstHour > 22) return { status: 'ok', suggestions: [] };

  const rangeStart = resolveCivilDateTimeInTimeZone(today.year, today.month, today.day, firstHour, 0, timeZone);
  const rangeEnd = resolveCivilDateTimeInTimeZone(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, timeZone);
  if (rangeStart.status !== 'resolved' || rangeEnd.status !== 'resolved') {
    return { status: 'invalid_timezone' };
  }

  const busyBlocks = await getGoogleCalendarBusyTimes(rangeStart.utc.toISOString(), rangeEnd.utc.toISOString());
  if (busyBlocks === null) return { status: 'unavailable' };

  const suggestions: CalendarAlternativeTime[] = [];
  for (let hour = firstHour; hour <= 22 && suggestions.length < 2; hour += 1) {
    const start = resolveCivilDateTimeInTimeZone(today.year, today.month, today.day, hour, 0, timeZone);
    const endHour = hour + 1;
    const end = endHour === 24
      ? resolveCivilDateTimeInTimeZone(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, timeZone)
      : resolveCivilDateTimeInTimeZone(today.year, today.month, today.day, endHour, 0, timeZone);
    if (start.status !== 'resolved' || end.status !== 'resolved') continue;

    const startMs = start.utc.getTime();
    const endMs = end.utc.getTime();
    const occupied = busyBlocks.some((block) => overlaps(startMs, endMs, block.start, block.end));
    if (!occupied) {
      suggestions.push({ hour, minute: 0, label: `${String(hour).padStart(2, '0')}:00` });
    }
  }

  return { status: 'ok', suggestions };
}
