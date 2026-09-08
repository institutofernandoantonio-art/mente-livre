import 'server-only';

import { getGoogleCalendarBusyTimes } from '../google/calendar';
import {
  addCivilDays,
  getCivilDateInTimeZone,
  isValidTimeZone,
  resolveCivilDateTimeInTimeZone,
} from './timezone';

export type CalendarAlternativeDay = 'today' | 'tomorrow';

export type CalendarAlternativeTime = {
  day: CalendarAlternativeDay;
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
  const dayAfterTomorrow = addCivilDays(tomorrow, 1);
  const currentCivilHour = Number(
    new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone }).format(new Date(now)),
  );
  const firstTodayHour = Math.max(requestedHour + 1, currentCivilHour + 1, 7);
  const hasTodayWindow = firstTodayHour <= 22;

  const rangeStart = hasTodayWindow
    ? resolveCivilDateTimeInTimeZone(today.year, today.month, today.day, firstTodayHour, 0, timeZone)
    : resolveCivilDateTimeInTimeZone(tomorrow.year, tomorrow.month, tomorrow.day, 7, 0, timeZone);
  const rangeEnd = resolveCivilDateTimeInTimeZone(
    dayAfterTomorrow.year,
    dayAfterTomorrow.month,
    dayAfterTomorrow.day,
    0,
    0,
    timeZone,
  );
  if (rangeStart.status !== 'resolved' || rangeEnd.status !== 'resolved') {
    return { status: 'invalid_timezone' };
  }

  const busyBlocks = await getGoogleCalendarBusyTimes(rangeStart.utc.toISOString(), rangeEnd.utc.toISOString());
  if (busyBlocks === null) return { status: 'unavailable' };
  const confirmedBusyBlocks = busyBlocks;

  const suggestions: CalendarAlternativeTime[] = [];

  function collectDay(
    day: typeof today,
    relativeDay: CalendarAlternativeDay,
    firstHour: number,
    lastHour: number,
    nextDay: typeof today,
  ) {
    for (let hour = firstHour; hour <= lastHour && suggestions.length < 2; hour += 1) {
      const start = resolveCivilDateTimeInTimeZone(day.year, day.month, day.day, hour, 0, timeZone);
      const endHour = hour + 1;
      const end = endHour === 24
        ? resolveCivilDateTimeInTimeZone(nextDay.year, nextDay.month, nextDay.day, 0, 0, timeZone)
        : resolveCivilDateTimeInTimeZone(day.year, day.month, day.day, endHour, 0, timeZone);
      if (start.status !== 'resolved' || end.status !== 'resolved') continue;

      const occupied = confirmedBusyBlocks.some((block) =>
        overlaps(start.utc.getTime(), end.utc.getTime(), block.start, block.end),
      );
      if (!occupied) {
        const prefix = relativeDay === 'today' ? 'Hoje' : 'Amanhã';
        suggestions.push({
          day: relativeDay,
          hour,
          minute: 0,
          label: `${prefix}, ${String(hour).padStart(2, '0')}:00`,
        });
      }
    }
  }

  if (hasTodayWindow) {
    collectDay(today, 'today', firstTodayHour, 22, tomorrow);
  }
  if (suggestions.length < 2) {
    collectDay(tomorrow, 'tomorrow', 7, 22, dayAfterTomorrow);
  }

  return { status: 'ok', suggestions };
}
