import 'server-only';

import type { EventReference, TemporalWindow } from './types';
import { resolveGoogleCalendarEventTarget } from './calendar-event-target-resolution';

export type CalendarEventCancellationProposal = {
  actionType: 'cancel_calendar_event';
  event: {
    title: string;
    start: string;
    end: string | null;
    allDay: boolean;
    timeZone: string;
  };
};

export type BuildCalendarEventCancellationProposalResult =
  | { status: 'proposed'; action: CalendarEventCancellationProposal }
  | { status: 'ambiguous' }
  | { status: 'not_found' }
  | { status: 'unsupported' }
  | { status: 'authorization_required' }
  | { status: 'error' };

// Materializa SOMENTE uma proposta segura de cancelamento. Resolve o alvo
// real no Google Calendar, descarta o id técnico imediatamente e devolve à
// próxima camada apenas um snapshot de apresentação/revalidação. Não
// persiste, não confirma e não executa DELETE.
export async function buildCalendarEventCancellationProposal(
  reference: EventReference,
  temporalWindow: TemporalWindow,
  now: number,
  timeZone: string,
): Promise<BuildCalendarEventCancellationProposalResult> {
  const resolution = await resolveGoogleCalendarEventTarget(
    reference,
    temporalWindow,
    now,
    timeZone,
  );

  switch (resolution.status) {
    case 'ambiguous':
      return { status: 'ambiguous' };
    case 'not_found':
      return { status: 'not_found' };
    case 'permissions':
      return { status: 'authorization_required' };
    case 'unsupported_window':
    case 'unsupported_reference':
      return { status: 'unsupported' };
    case 'unavailable':
    case 'error':
      return { status: 'error' };
    case 'resolved':
      return {
        status: 'proposed',
        action: {
          actionType: 'cancel_calendar_event',
          event: {
            title: resolution.target.title,
            start: resolution.target.start,
            end: resolution.target.end,
            allDay: resolution.target.allDay,
            timeZone,
          },
        },
      };
  }
}
