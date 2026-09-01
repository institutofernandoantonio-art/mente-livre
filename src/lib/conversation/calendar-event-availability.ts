import 'server-only';

import { getGoogleCalendarBusyTimes } from '../google/calendar';

// ============================================================================
// Calendar event availability — a menor fronteira que verifica se a janela
// exata de um `ProposedAction.create_calendar_event` já materializado está
// livre no Google Calendar, ANTES de propor a criação do evento (Subfase 2
// da criação de compromissos no Google Calendar).
//
// Reaproveita `getGoogleCalendarBusyTimes` EXATAMENTE como está — mesmo
// escopo OAuth (`calendar.events.freebusy`), mesmo mecanismo de refresh
// token, mesmo client, zero admin/service-role novo, zero alteração em
// `../google/calendar`. Este módulo só chama e traduz o resultado; nunca
// reimplementa nada de `getGoogleCalendarBusyTimes`.
//
// `start`/`end` chegam sempre como as MESMAS strings ISO já produzidas por
// `buildCreateCalendarEventAction` (Subfase 1) — nunca reformatadas,
// arredondadas ou ampliadas aqui. Nenhuma validação de forma é repetida
// neste módulo: o único chamador real (`conversation-turn.ts`) só invoca
// isto depois de um resultado `built`, que já garante ISO válido e
// `end > start` — revalidar aqui duplicaria uma garantia que já tem dono.
//
// Blocos ocupados (`busyBlocks`) NUNCA saem desta função — nem os
// intervalos brutos, nem a contagem. O único sinal que atravessa esta
// fronteira é `available`/`busy`/`unavailable`, exatamente o mínimo
// necessário para a decisão de propor ou não.
//
// `unavailable` colapsa deliberadamente "Calendar não conectado" e
// "falha técnica" no mesmo status — mesma decisão já tomada por
// `getGoogleCalendarBusyTimes`/`calendar-query.ts` (ambos os casos
// retornam `null`, indistinguíveis por design). Nunca tratado como
// "livre" nem como "ocupado": um evento nunca é proposto quando a
// disponibilidade real não pôde ser confirmada.
//
// Zero retry, zero segunda chamada, zero fallback — no máximo 1 chamada a
// `getGoogleCalendarBusyTimes` por invocação.
// ============================================================================

export type CalendarEventAvailabilityResult =
  | { status: 'available' }
  | { status: 'busy' }
  | { status: 'unavailable' };

export async function checkCalendarEventAvailability(
  start: string,
  end: string,
): Promise<CalendarEventAvailabilityResult> {
  const busyBlocks = await getGoogleCalendarBusyTimes(start, end);

  if (busyBlocks === null) {
    return { status: 'unavailable' };
  }

  if (busyBlocks.length === 0) {
    return { status: 'available' };
  }

  return { status: 'busy' };
}
