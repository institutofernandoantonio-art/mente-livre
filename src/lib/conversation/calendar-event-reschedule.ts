import 'server-only';

import { isValidTimeZone } from './timezone';
import { getGoogleCalendarEventTargetsInWindow } from '../google/calendar-event-targets';
import { updateGoogleCalendarEventTimeById } from '../google/calendar-event-update';

export type CalendarEventRescheduleSnapshot = {
  title: string;
  originalStart: string;
  originalEnd: string;
  newStart: string;
  newEnd: string;
  allDay: false;
  timeZone: string;
};

export type RescheduleCalendarEventFromSnapshotResult =
  | { status: 'updated' }
  | { status: 'not_found' }
  | { status: 'ambiguous' }
  | { status: 'conflict' }
  | { status: 'authorization_required' }
  | { status: 'unsupported' }
  | { status: 'error' };

// Executa a alteração somente a partir de um snapshot de confirmação sem id
// técnico. Antes do PATCH, o evento original é localizado novamente por
// título + início + fim EXATOS. Em seguida a nova janela é consultada ao vivo
// e qualquer outro evento nela bloqueia a mutação. O googleEventId nasce e
// morre dentro desta função server-side.
export async function rescheduleCalendarEventFromSnapshot(
  snapshot: CalendarEventRescheduleSnapshot,
): Promise<RescheduleCalendarEventFromSnapshotResult> {
  if (!isValidSnapshot(snapshot)) {
    return { status: 'unsupported' };
  }

  const originalStartMs = Date.parse(snapshot.originalStart);
  const originalEndMs = Date.parse(snapshot.originalEnd);
  const newStartMs = Date.parse(snapshot.newStart);
  const newEndMs = Date.parse(snapshot.newEnd);

  if (
    !Number.isFinite(originalStartMs) ||
    !Number.isFinite(originalEndMs) ||
    !Number.isFinite(newStartMs) ||
    !Number.isFinite(newEndMs) ||
    originalEndMs <= originalStartMs ||
    newEndMs <= newStartMs ||
    newEndMs - newStartMs !== originalEndMs - originalStartMs
  ) {
    return { status: 'unsupported' };
  }

  // Janela estreita ao redor do horário ORIGINAL: só um match exatamente
  // igual ao snapshot pode ser alterado. Mudança de título/horário entre a
  // proposta e a confirmação faz o fluxo falhar fechado.
  const sourceTimeMin = new Date(originalStartMs - 60_000).toISOString();
  const sourceTimeMax = new Date(originalEndMs + 60_000).toISOString();
  const sourceLookup = await getGoogleCalendarEventTargetsInWindow(
    sourceTimeMin,
    sourceTimeMax,
    snapshot.timeZone,
    10,
  );

  switch (sourceLookup.status) {
    case 'permissions':
      return { status: 'authorization_required' };
    case 'unavailable':
    case 'error':
      return { status: 'error' };
    case 'ok':
      break;
  }

  const exactMatches = sourceLookup.events.filter(
    (event) =>
      !event.allDay &&
      event.title === snapshot.title &&
      event.start === snapshot.originalStart &&
      event.end === snapshot.originalEnd,
  );

  if (exactMatches.length === 0) {
    return { status: 'not_found' };
  }
  if (exactMatches.length > 1) {
    return { status: 'ambiguous' };
  }

  const sourceEventId = exactMatches[0].googleEventId;

  // A disponibilidade é conferida DEPOIS da revalidação do alvo e ANTES do
  // PATCH. O próprio evento original é ignorado pela identidade server-side,
  // o que permite mover dentro de uma janela que ainda sobreponha parte do
  // horário antigo sem criar um falso conflito consigo mesmo.
  const destinationLookup = await getGoogleCalendarEventTargetsInWindow(
    snapshot.newStart,
    snapshot.newEnd,
    snapshot.timeZone,
    10,
  );

  switch (destinationLookup.status) {
    case 'permissions':
      return { status: 'authorization_required' };
    case 'unavailable':
    case 'error':
      return { status: 'error' };
    case 'ok':
      break;
  }

  const blockingEvents = destinationLookup.events.filter(
    (event) => event.googleEventId !== sourceEventId,
  );
  if (blockingEvents.length > 0) {
    return { status: 'conflict' };
  }

  const update = await updateGoogleCalendarEventTimeById(
    sourceEventId,
    snapshot.newStart,
    snapshot.newEnd,
    snapshot.timeZone,
  );

  switch (update.status) {
    case 'updated':
      return { status: 'updated' };
    case 'not_found':
      return { status: 'not_found' };
    case 'authorization_required':
      return { status: 'authorization_required' };
    case 'error':
      return { status: 'error' };
  }
}

function isValidSnapshot(value: CalendarEventRescheduleSnapshot): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (typeof value.title !== 'string' || value.title.trim().length === 0 || value.title.length > 180) {
    return false;
  }
  if (value.allDay !== false) return false;
  if (!isValidTimeZone(value.timeZone)) return false;

  for (const instant of [value.originalStart, value.originalEnd, value.newStart, value.newEnd]) {
    if (typeof instant !== 'string' || Number.isNaN(Date.parse(instant))) {
      return false;
    }
  }

  return true;
}
