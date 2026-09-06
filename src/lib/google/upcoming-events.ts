'use server';
import 'server-only';

import { isValidTimeZone } from '@/lib/conversation/timezone';
import { getGoogleCalendarAccessToken } from './calendar';

// Leitura mínima dos próximos compromissos da agenda principal.
//
// Segurança/privacidade:
// - token Google nunca sai do servidor;
// - consulta somente `calendarId=primary`;
// - pede ao endpoint APENAS título, início e htmlLink — nunca descrição,
//   participantes, localização, anexos ou outros metadados do compromisso;
// - nenhum dado de evento é persistido ou cacheado pelo Mente Livre;
// - timezone vem do browser apenas para apresentação temporal, nunca para
//   autenticação/autorização;
// - qualquer payload inesperado é rejeitado/normalizado antes de atravessar
//   a fronteira servidor -> cliente.
export async function getUpcomingGoogleCalendarEvents(timeZone: string) {
  if (!isValidTimeZone(timeZone)) {
    return { status: 'unavailable' as const, events: [] };
  }

  const accessToken = await getGoogleCalendarAccessToken();
  if (!accessToken) {
    return { status: 'unavailable' as const, events: [] };
  }

  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('timeMin', new Date().toISOString());
  url.searchParams.set('maxResults', '4');
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('showDeleted', 'false');
  url.searchParams.set('timeZone', timeZone);
  url.searchParams.set(
    'fields',
    'items(summary,status,htmlLink,start(date,dateTime,timeZone))',
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch {
    return { status: 'error' as const, events: [] };
  }

  // Conexões antigas podem ter sido autorizadas apenas para freebusy.
  // Nesses casos, a UI deve pedir reconexão em vez de tratar como agenda vazia.
  if (response.status === 401 || response.status === 403) {
    return { status: 'permissions' as const, events: [] };
  }

  if (!response.ok) {
    return { status: 'error' as const, events: [] };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'error' as const, events: [] };
  }

  if (typeof payload !== 'object' || payload === null || !('items' in payload)) {
    return { status: 'error' as const, events: [] };
  }

  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return { status: 'error' as const, events: [] };
  }

  const events = items.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) {
      return [];
    }

    const event = raw as {
      summary?: unknown;
      status?: unknown;
      htmlLink?: unknown;
      start?: unknown;
    };

    if (event.status === 'cancelled') {
      return [];
    }

    const start = readEventDate(event.start);
    if (!start) {
      return [];
    }

    const htmlLink = typeof event.htmlLink === 'string' && isSafeHttpsUrl(event.htmlLink)
      ? event.htmlLink
      : null;

    return [
      {
        title:
          typeof event.summary === 'string' && event.summary.trim().length > 0
            ? event.summary.trim().slice(0, 180)
            : 'Sem título',
        start: start.value,
        allDay: start.kind === 'date',
        htmlLink,
      },
    ];
  }).slice(0, 4);

  return { status: 'ok' as const, events };
}

function readEventDate(value: unknown): { kind: 'date' | 'dateTime'; value: string } | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as { date?: unknown; dateTime?: unknown };
  if (typeof candidate.dateTime === 'string' && !Number.isNaN(Date.parse(candidate.dateTime))) {
    return { kind: 'dateTime', value: candidate.dateTime };
  }

  if (
    typeof candidate.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.date)
  ) {
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
