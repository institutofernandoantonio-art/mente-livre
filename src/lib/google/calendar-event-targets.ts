'use server';
import 'server-only';

import { isValidTimeZone } from '@/lib/conversation/timezone';
import { getGoogleCalendarAccessToken } from './calendar';

export type GoogleCalendarEventTarget = {
  googleEventId: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
};

export type GoogleCalendarEventTargetsResult =
  | { status: 'ok'; events: GoogleCalendarEventTarget[] }
  | { status: 'permissions'; events: [] }
  | { status: 'unavailable'; events: [] }
  | { status: 'error'; events: [] };

// Leitura server-only usada exclusivamente para resolver, com segurança,
// qual evento real uma futura ação mutável pretende atingir. O id técnico
// do Google existe somente nesta fronteira server-side e nunca deve ser
// devolvido à UI ou incorporado em texto de apresentação.
export async function getGoogleCalendarEventTargetsInWindow(
  timeMin: string,
  timeMax: string,
  timeZone: string,
  maxResults = 10,
): Promise<GoogleCalendarEventTargetsResult> {
  if (
    !isIsoInstant(timeMin) ||
    !isIsoInstant(timeMax) ||
    Date.parse(timeMax) <= Date.parse(timeMin) ||
    !isValidTimeZone(timeZone)
  ) {
    return { status: 'unavailable', events: [] };
  }

  const accessToken = await getGoogleCalendarAccessToken();
  if (!accessToken) {
    return { status: 'unavailable', events: [] };
  }

  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('maxResults', String(clampMaxResults(maxResults)));
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('showDeleted', 'false');
  url.searchParams.set('timeZone', timeZone);
  url.searchParams.set('fields', 'items(id,summary,status,start(date,dateTime),end(date,dateTime))');

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

  const events = items.flatMap(normalizeTarget).slice(0, clampMaxResults(maxResults));
  return { status: 'ok', events };
}

function normalizeTarget(raw: unknown): GoogleCalendarEventTarget[] {
  if (typeof raw !== 'object' || raw === null) return [];

  const event = raw as {
    id?: unknown;
    summary?: unknown;
    status?: unknown;
    start?: unknown;
    end?: unknown;
  };

  if (event.status === 'cancelled') return [];
  if (typeof event.id !== 'string' || !isSafeGoogleEventId(event.id)) return [];

  const start = readEventDate(event.start);
  if (!start) return [];
  const end = readEventDate(event.end);

  return [
    {
      googleEventId: event.id,
      title:
        typeof event.summary === 'string' && event.summary.trim().length > 0
          ? event.summary.trim().slice(0, 180)
          : 'Sem título',
      start: start.value,
      end: end?.value ?? null,
      allDay: start.kind === 'date',
    },
  ];
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

function isSafeGoogleEventId(value: string): boolean {
  return value.length >= 1 && value.length <= 1024 && !/[\s/\\?#]/.test(value);
}

function isIsoInstant(value: string): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function clampMaxResults(value: number): number {
  if (!Number.isInteger(value)) return 10;
  return Math.min(Math.max(value, 1), 10);
}
