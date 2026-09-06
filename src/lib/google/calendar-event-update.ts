'use server';
import 'server-only';

import { isValidTimeZone } from '@/lib/conversation/timezone';
import {
  getGoogleCalendarAccessToken,
  hasGoogleCalendarEventWriteAuthorization,
} from './calendar';

export type UpdateGoogleCalendarEventTimeResult =
  | { status: 'updated' }
  | { status: 'not_found' }
  | { status: 'authorization_required' }
  | { status: 'error' };

// Primitiva mínima de PATCH para um evento JÁ resolvido por uma camada
// server-side. Não interpreta linguagem natural, não escolhe candidato e
// não decide confirmação. Atualiza SOMENTE start/end; título, descrição,
// participantes e demais campos do evento ficam fora do payload e são
// preservados pelo PATCH do Google Calendar.
//
// `googleEventId` é identificador técnico interno: nunca deve vir do browser
// nem voltar em nenhum resultado desta função.
export async function updateGoogleCalendarEventTimeById(
  googleEventId: string,
  start: string,
  end: string,
  timeZone: string,
): Promise<UpdateGoogleCalendarEventTimeResult> {
  if (
    !isSafeGoogleEventId(googleEventId) ||
    !isIsoInstant(start) ||
    !isIsoInstant(end) ||
    Date.parse(end) <= Date.parse(start) ||
    !isValidTimeZone(timeZone)
  ) {
    return { status: 'error' };
  }

  // Menor privilégio: a capacidade de escrita conhecida é conferida ANTES
  // de obter access token e antes de qualquer mutação externa.
  const authorization = await hasGoogleCalendarEventWriteAuthorization();
  if (authorization === 'unauthorized') {
    return { status: 'authorization_required' };
  }
  if (authorization === 'error') {
    return { status: 'error' };
  }

  const accessToken = await getGoogleCalendarAccessToken();
  if (!accessToken) {
    return { status: 'authorization_required' };
  }

  const encodedEventId = encodeURIComponent(googleEventId);
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodedEventId}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        start: { dateTime: start, timeZone },
        end: { dateTime: end, timeZone },
      }),
    });
  } catch {
    return { status: 'error' };
  }

  if (response.status === 200 || response.status === 204) {
    return { status: 'updated' };
  }
  if (response.status === 404 || response.status === 410) {
    return { status: 'not_found' };
  }
  if (response.status === 401) {
    return { status: 'authorization_required' };
  }

  // 403 pode representar política, quota ou outra falha operacional; nunca
  // é convertido automaticamente em "reconecte" sem certeza.
  return { status: 'error' };
}

function isSafeGoogleEventId(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 1024 &&
    !/[\s/\\?#]/.test(value)
  );
}

function isIsoInstant(value: string): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
