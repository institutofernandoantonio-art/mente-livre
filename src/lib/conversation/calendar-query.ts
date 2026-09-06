import 'server-only';

import type { StructuredIntent } from './types';
import { getGoogleCalendarEventsInWindow } from '../google/upcoming-events';
import { isValidTimeZone, getCivilDateInTimeZone, addCivilDays, resolveCivilDateTimeInTimeZone } from './timezone';

export type CalendarQueryEvent = {
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
};

export type CalendarQueryResult =
  | { status: 'events'; scope: 'day' | 'hour'; timeZone: string; events: CalendarQueryEvent[] }
  | { status: 'available'; scope: 'day' | 'hour' }
  | { status: 'unsupported_window' }
  | { status: 'error' };

type QueryCalendarIntent = Extract<StructuredIntent, { intentType: 'query_calendar' }>;
type ResolvedWindow = { start: Date; end: Date; scope: 'day' | 'hour' };

function resolveRelativeDayWindow(
  now: Date,
  timeZone: string,
  day: 'today' | 'tomorrow',
  time: { hour: number; minute: number } | null,
): ResolvedWindow | null {
  const today = getCivilDateInTimeZone(now, timeZone);
  const civilDay = day === 'today' ? today : addCivilDays(today, 1);

  if (time === null) {
    const nextCivilDay = addCivilDays(civilDay, 1);
    const startResolution = resolveCivilDateTimeInTimeZone(civilDay.year, civilDay.month, civilDay.day, 0, 0, timeZone);
    const endResolution = resolveCivilDateTimeInTimeZone(
      nextCivilDay.year,
      nextCivilDay.month,
      nextCivilDay.day,
      0,
      0,
      timeZone,
    );
    if (startResolution.status !== 'resolved' || endResolution.status !== 'resolved') return null;
    return { start: startResolution.utc, end: endResolution.utc, scope: 'day' };
  }

  const startResolution = resolveCivilDateTimeInTimeZone(
    civilDay.year,
    civilDay.month,
    civilDay.day,
    time.hour,
    time.minute,
    timeZone,
  );
  if (startResolution.status !== 'resolved') return null;

  return {
    start: startResolution.utc,
    end: new Date(startResolution.utc.getTime() + 60 * 60_000),
    scope: 'hour',
  };
}

export async function resolveCalendarQuery(
  intent: QueryCalendarIntent,
  now: number,
  timezone: string,
): Promise<CalendarQueryResult> {
  if (!isValidTimeZone(timezone)) return { status: 'unsupported_window' };

  const resolved = intent.temporalWindow.resolved;
  if (resolved.kind !== 'relative_day') return { status: 'unsupported_window' };

  const nowDate = new Date(now);
  if (Number.isNaN(nowDate.getTime())) return { status: 'error' };

  const window = resolveRelativeDayWindow(nowDate, timezone, resolved.day, resolved.time);
  if (window === null) return { status: 'unsupported_window' };

  const calendarResult = await getGoogleCalendarEventsInWindow(
    window.start.toISOString(),
    window.end.toISOString(),
    timezone,
    8,
  );

  if (calendarResult.status !== 'ok') return { status: 'error' };
  if (calendarResult.events.length === 0) return { status: 'available', scope: window.scope };

  return {
    status: 'events',
    scope: window.scope,
    timeZone: timezone,
    events: calendarResult.events.map((event) => ({
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
    })),
  };
}
