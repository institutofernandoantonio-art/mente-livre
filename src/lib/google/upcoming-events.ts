'use server';
import 'server-only';

import { isValidTimeZone } from '@/lib/conversation/timezone';
import { getGoogleCalendarAccessToken } from './calendar';

export type GoogleCalendarEventSummary = {
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  htmlLink: string | null;
};

export type GoogleCalendarEventsResult =
  | { status: 'ok'; events: GoogleCalendarEventSummary[] }
  | { status: 'permissions'; events: [] }
  | { status: 'unavailable'; events: [] }
  | { status: 'error'; events: [] };

// Leitura mínima dos compromissos da agenda principal.
// Segurança/privacidade:
// - token Google nunca sai do servidor;
// - consulta somente calendarId=primary;
// - pede apenas título, início, fim e htmlLink;
// - nunca persiste nem cacheia detalhes dos eventos;
// - timezone serve só para cálculo/apresentação, nunca autorização.
export async function getUpcomingGoogleCalendarEvents(timeZone: string): Promise<GoogleCalendarEventsResult> {
  return queryGoogleCalendarEvents({
    timeZone,
    timeMin: new Date().toISOString(),
    timeMax: null,
    maxResults: 4,
  });
}

export async function getGoogleCalendarEventsInWindow(
  timeMin: string,
  timeMax: string,
  timeZone: string,
  maxResults = 8,
): Promise<GoogleCalendarEventsResult> {
  if (!isIsoInstant(timeMin) || !isIsoInstant(timeMax) || Date.parse(timeMax) <= Date.parse(timeMin)) {
    return { status: 'unavailable', events: [] };
  }

  return queryGoogleCalendarEvents({
    timeZone,
    timeMin,
    timeMax,
    maxResults: clampMaxResults(maxResults),
  });
}

async function queryGoogleCalendarEvents(input: {
  timeZone: string;
  timeMin: string;
  timeMax: string | null;
  maxResults: number;
}): Promise<GoogleCalendarEventsResult> {
  if (!isValidTimeZone(input.timeZone)) {
    return { status: 'unavailable', events: [] };
  }

  const accessToken = await getGoogleCalendarAccessToken();
  if (!accessToken) {
    return { status: 'unavailable', events: [] };
  }

  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('timeMin', input.timeMin);
  if (input.timeMax) url.searchParams.set('timeMax', input.timeMax);
  url.searchParams.set('maxResults', String(input.maxResults));
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('showDeleted', 'false');
  url.searchParams.set('timeZone', input.timeZone);
  url.searchParams.set('fields', 'items(summary,status,htmlLink,start(date,dateTime,timeZone),end(date,dateTime,timeZone))');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch {
    return { status: 'error', events: [] };
  }

  if (response.status === 401 || response.status === 403) {
    return { status: 'permissions', events: [] };
  }
  if (!response.ok) {
    return { status: 'error', events: [] };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'error', events: [] };
  }

  if (typeof payload !== 'object' || payload === null || !('items' in payload)) {
    return { status: 'error', events: [] };
  }

  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return { status: 'error', events: [] };
  }

  const events = items.flatMap((raw) => normalizeEvent(raw)).slice(0, input.maxResults);
  return { status: 'ok', events };
}

function normalizeEvent(raw: unknown): GoogleCalendarEventSummary[] {
  if (typeof raw !== 'object' || raw === null) return [];

  const event = raw as {
    summary?: unknown;
    status?: unknown;
    htmlLink?: unknown;
    start?: unknown;
    end?: unknown;
  };

  if (event.status === 'cancelled') return [];

  const start = readEventDate(event.start);
  if (!start) return [];
  const end = readEventDate(event.end);

  const htmlLink = typeof event.htmlLink === 'string' && isSafeHttpsUrl(event.htmlLink)
    ? event.htmlLink
    : null;

  return [{
    title:
      typeof event.summary === 'string' && event.summary.trim().length > 0
        ? event.summary.trim().slice(0, 180)
        : 'Sem título',
    start: start.value,
    end: end?.value ?? null,
    allDay: start.kind === 'date',
    htmlLink,
  }];
}

function readEventDate(value: unknown): { kind: 'date' | 'dateTime'; value: string } | null {
  if (typeof value !== 'object' || value === null) return null;

  const candidate = value as { date?: unknown; dateTime?: unknown };
  if (typeof candidate.dateTime === 'string' && !Number.isNaN(Date.parse(candidate.dateTime))) {
    return { kind: 'dateTime', value: candidate.dateTime };
  }
  if (typeof candidate.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.date)) {
    return { kind: 'date', value: candidate.date };
  }
  return null;
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isIsoInstant(value: string): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function clampMaxResults(value: number): number {
  if (!Number.isInteger(value)) return 8;
  return Math.min(Math.max(value, 1), 10);
}
