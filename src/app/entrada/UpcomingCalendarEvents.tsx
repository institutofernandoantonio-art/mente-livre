'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { getUpcomingGoogleCalendarEvents } from '@/lib/google/upcoming-events';

type CalendarEvent = {
  title: string;
  start: string;
  allDay: boolean;
  htmlLink: string | null;
};

type LoadState =
  | { status: 'loading'; events: CalendarEvent[] }
  | { status: 'ok'; events: CalendarEvent[] }
  | { status: 'unavailable'; events: CalendarEvent[] }
  | { status: 'permissions'; events: CalendarEvent[] }
  | { status: 'error'; events: CalendarEvent[] };

export function UpcomingCalendarEvents() {
  const [state, setState] = useState<LoadState>({ status: 'loading', events: [] });
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const result = await getUpcomingGoogleCalendarEvents(timeZone);
        if (active) {
          setState(result);
        }
      } catch {
        if (active) {
          setState({ status: 'error', events: [] });
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [timeZone]);

  if (state.status === 'unavailable') {
    return null;
  }

  return (
    <div className="mt-5">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Próximos compromissos</p>
            <p className="mt-1 text-xs text-ink-soft">Sua agenda, sem sair do Mente Livre.</p>
          </div>
          <a
            href="https://calendar.google.com/calendar/u/0/r"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            Abrir agenda
          </a>
        </div>

        {state.status === 'loading' && (
          <p className="mt-4 text-sm text-ink-soft">Carregando compromissos...</p>
        )}

        {state.status === 'permissions' && (
          <p className="mt-4 text-sm text-ink-soft">
            Reconecte o Google Calendar para mostrar seus próximos compromissos aqui.
          </p>
        )}

        {state.status === 'error' && (
          <p className="mt-4 text-sm text-ink-soft">
            Não consegui carregar sua agenda agora. Você pode continuar usando o Mente Livre normalmente.
          </p>
        )}

        {state.status === 'ok' && state.events.length === 0 && (
          <p className="mt-4 text-sm text-ink-soft">Nenhum compromisso futuro encontrado.</p>
        )}

        {state.status === 'ok' && state.events.length > 0 && (
          <ul className="mt-4 space-y-2">
            {state.events.map((event, index) => {
              const content = (
                <div className="rounded-xl border border-black/5 px-3 py-2.5 transition hover:bg-black/[0.02]">
                  <p className="truncate text-sm font-medium text-ink">{event.title}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">{formatEventWhen(event, timeZone)}</p>
                </div>
              );

              return (
                <li key={`${event.start}-${event.title}-${index}`}>
                  {event.htmlLink ? (
                    <a
                      href={event.htmlLink}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Abrir ${event.title} no Google Calendar`}
                    >
                      {content}
                    </a>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function formatEventWhen(event: CalendarEvent, timeZone: string): string {
  if (event.allDay) {
    const [year, month, day] = event.start.split('-').map(Number);
    if (!year || !month || !day) {
      return 'Dia inteiro';
    }
    const safeDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const dateLabel = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    }).format(safeDate);
    return `${dateLabel} · dia inteiro`;
  }

  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) {
    return '';
  }

  const dateLabel = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone,
  }).format(start);

  const timeLabel = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(start);

  return `${dateLabel} · ${timeLabel}`;
}
