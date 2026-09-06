import 'server-only';

import type { EventReference, TemporalWindow } from './types';
import { addCivilDays, getCivilDateInTimeZone, isValidTimeZone, resolveCivilDateTimeInTimeZone } from './timezone';
import {
  getGoogleCalendarEventTargetsInWindow,
  type GoogleCalendarEventTarget,
} from '../google/calendar-event-targets';

export type CalendarEventTargetResolutionResult =
  | { status: 'resolved'; target: GoogleCalendarEventTarget }
  | { status: 'ambiguous' }
  | { status: 'not_found' }
  | { status: 'unsupported_window' }
  | { status: 'unsupported_reference' }
  | { status: 'permissions' }
  | { status: 'unavailable' }
  | { status: 'error' };

type ResolvedWindow = { start: Date; end: Date };

// Resolve SOMENTE um alvo do Google Calendar. Não confirma, não persiste e
// não executa DELETE. Alta precisão: zero/mais de um match nunca vira uma
// escolha automática.
export async function resolveGoogleCalendarEventTarget(
  reference: EventReference,
  temporalWindow: TemporalWindow,
  now: number,
  timeZone: string,
): Promise<CalendarEventTargetResolutionResult> {
  if (reference.resolvedId !== null) {
    return { status: 'unsupported_reference' };
  }
  if (normalizeForComparison(reference.raw) === '') {
    return { status: 'unsupported_reference' };
  }
  if (!Number.isSafeInteger(now) || !isValidTimeZone(timeZone)) {
    return { status: 'unsupported_window' };
  }

  const window = resolveSafeRelativeDayWindow(temporalWindow, new Date(now), timeZone);
  if (window === null) {
    return { status: 'unsupported_window' };
  }

  const calendarResult = await getGoogleCalendarEventTargetsInWindow(
    window.start.toISOString(),
    window.end.toISOString(),
    timeZone,
    10,
  );

  switch (calendarResult.status) {
    case 'permissions':
      return { status: 'permissions' };
    case 'unavailable':
      return { status: 'unavailable' };
    case 'error':
      return { status: 'error' };
    case 'ok':
      break;
  }

  const matches = matchTarget(reference.raw, calendarResult.events);
  if (matches.length === 0) return { status: 'not_found' };
  if (matches.length > 1) return { status: 'ambiguous' };
  return { status: 'resolved', target: matches[0] };
}

function resolveSafeRelativeDayWindow(
  temporalWindow: TemporalWindow,
  now: Date,
  timeZone: string,
): ResolvedWindow | null {
  const resolved = temporalWindow.resolved;
  if (resolved.kind !== 'relative_day') return null;

  const today = getCivilDateInTimeZone(now, timeZone);
  const civilDay = resolved.day === 'today' ? today : addCivilDays(today, 1);

  if (resolved.time === null) {
    const nextCivilDay = addCivilDays(civilDay, 1);
    const start = resolveCivilDateTimeInTimeZone(civilDay.year, civilDay.month, civilDay.day, 0, 0, timeZone);
    const end = resolveCivilDateTimeInTimeZone(
      nextCivilDay.year,
      nextCivilDay.month,
      nextCivilDay.day,
      0,
      0,
      timeZone,
    );
    if (start.status !== 'resolved' || end.status !== 'resolved') return null;
    return { start: start.utc, end: end.utc };
  }

  const start = resolveCivilDateTimeInTimeZone(
    civilDay.year,
    civilDay.month,
    civilDay.day,
    resolved.time.hour,
    resolved.time.minute,
    timeZone,
  );
  if (start.status !== 'resolved') return null;

  return { start: start.utc, end: new Date(start.utc.getTime() + 60 * 60_000) };
}

function matchTarget(referenceRaw: string, candidates: readonly GoogleCalendarEventTarget[]): GoogleCalendarEventTarget[] {
  const normalizedReference = normalizeForComparison(referenceRaw);

  const exact = candidates.filter(
    (candidate) => normalizeForComparison(candidate.title) === normalizedReference,
  );
  if (exact.length > 0) return exact;

  // Fallback conservador já usado no matcher local do projeto: a referência
  // precisa aparecer inteira e de forma contígua no título. Nunca fuzzy,
  // stemming, distância de edição ou escolha por maior "similaridade".
  return candidates.filter((candidate) =>
    normalizeForComparison(candidate.title).includes(normalizedReference),
  );
}

function normalizeForComparison(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
