import 'server-only';

import { isValidTimeZone } from './timezone';
import { getGoogleCalendarEventTargetsInWindow } from '../google/calendar-event-targets';
import { deleteGoogleCalendarEventById } from '../google/calendar-event-delete';

export type CalendarEventDeletionSnapshot = {
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  timeZone: string;
};

export type DeleteCalendarEventFromSnapshotResult =
  | { status: 'deleted' }
  | { status: 'not_found' }
  | { status: 'ambiguous' }
  | { status: 'authorization_required' }
  | { status: 'unsupported' }
  | { status: 'error' };

// Revalida o alvo IMEDIATAMENTE antes do DELETE usando somente um snapshot
// de apresentação seguro — nunca um googleEventId vindo do browser ou
// persistido numa ProposedAction pública. O id técnico só nasce de novo na
// consulta server-side abaixo e é entregue diretamente à primitiva de
// exclusão.
//
// Nesta primeira versão mutável, cancelamento de evento de dia inteiro fica
// deliberadamente fora: é preferível recusar do que introduzir uma segunda
// lógica de resolução civil só para DELETE. Reuniões/compromissos com hora
// são o alvo da subfase atual.
export async function deleteCalendarEventFromSnapshot(
  snapshot: CalendarEventDeletionSnapshot,
): Promise<DeleteCalendarEventFromSnapshotResult> {
  if (!isValidSnapshot(snapshot)) {
    return { status: 'unsupported' };
  }

  const startMs = Date.parse(snapshot.start);
  const endMs = snapshot.end === null ? startMs + 60 * 60_000 : Date.parse(snapshot.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { status: 'unsupported' };
  }

  // Janela pequena ao redor do início original. Mesmo que outros eventos
  // apareçam nela, só um match EXATO do snapshot abaixo pode ser apagado.
  const timeMin = new Date(startMs - 60_000).toISOString();
  const timeMax = new Date(Math.max(endMs, startMs + 60_000) + 60_000).toISOString();

  const lookup = await getGoogleCalendarEventTargetsInWindow(
    timeMin,
    timeMax,
    snapshot.timeZone,
    10,
  );

  switch (lookup.status) {
    case 'permissions':
      return { status: 'authorization_required' };
    case 'unavailable':
    case 'error':
      return { status: 'error' };
    case 'ok':
      break;
  }

  const exactMatches = lookup.events.filter(
    (event) =>
      !event.allDay &&
      event.title === snapshot.title &&
      event.start === snapshot.start &&
      event.end === snapshot.end,
  );

  if (exactMatches.length === 0) {
    // Mudou de horário/título, foi removido ou deixou de ser identificável:
    // nunca apaga um "parecido". O usuário precisa refazer o pedido.
    return { status: 'not_found' };
  }
  if (exactMatches.length > 1) {
    return { status: 'ambiguous' };
  }

  const deletion = await deleteGoogleCalendarEventById(exactMatches[0].googleEventId);
  switch (deletion.status) {
    case 'deleted':
      return { status: 'deleted' };
    case 'not_found':
      return { status: 'not_found' };
    case 'authorization_required':
      return { status: 'authorization_required' };
    case 'error':
      return { status: 'error' };
  }
}

function isValidSnapshot(value: CalendarEventDeletionSnapshot): boolean {
  if (typeof value.title !== 'string' || value.title.trim().length === 0 || value.title.length > 180) {
    return false;
  }
  if (value.allDay) {
    return false;
  }
  if (!isValidTimeZone(value.timeZone)) {
    return false;
  }
  if (typeof value.start !== 'string' || Number.isNaN(Date.parse(value.start))) {
    return false;
  }
  return value.end === null || (typeof value.end === 'string' && !Number.isNaN(Date.parse(value.end)));
}
