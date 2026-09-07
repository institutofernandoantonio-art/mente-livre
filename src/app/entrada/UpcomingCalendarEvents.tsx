'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { getUpcomingGoogleCalendarEvents } from '@/lib/google/upcoming-events';
import { buildGoogleCalendarAccountUrl } from '@/lib/google/calendar-web-url';

type CalendarEvent = {
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  htmlLink: string | null;
};

type LoadState =
  | { status: 'loading'; events: CalendarEvent[] }
  | { status: 'ok'; events: CalendarEvent[] }
  | { status: 'unavailable'; events: CalendarEvent[] }
  | { status: 'permissions'; events: CalendarEvent[] }
  | { status: 'error'; events: CalendarEvent[] };

type UpcomingCalendarEventsProps = {
  calendarUrl: string;
  accountEmail: string;
  focusTitle?: string | null;
};

export function UpcomingCalendarEvents({
  calendarUrl,
  accountEmail,
  focusTitle = null,
}: UpcomingCalendarEventsProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading', events: [] });
  const [now, setNow] = useState(() => Date.now());
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const result = await getUpcomingGoogleCalendarEvents(timeZone);
        if (active) {
          setState(result);
          setNow(Date.now());
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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (state.status === 'unavailable') {
    return null;
  }

  const proximity = state.status === 'ok' ? getUpcomingProximity(state.events, now) : null;
  const focusGuidance = state.status === 'ok' ? getFocusGuidance(state.events, now, focusTitle) : null;

  return (
    <div className="mt-5">
      {focusGuidance && (
        <Card className="mb-4 border border-brand-600/25 bg-brand-600/[0.04]">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{focusGuidance.label}</p>
          <p className="mt-2 text-sm font-medium text-ink">{focusGuidance.detail}</p>
          <p className="mt-1 text-xs text-ink-soft">A sugestão usa apenas sua prioridade atual e o próximo compromisso conhecido.</p>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Próximos compromissos</p>
            <p className="mt-1 text-xs text-ink-soft">O que vem a seguir na sua agenda.</p>
          </div>
          <a
            href={calendarUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            Abrir agenda
          </a>
        </div>

        {proximity && (
          <div role="status" className="mt-4 rounded-xl border border-brand-600/30 bg-brand-600/[0.06] px-3 py-3">
            <p className="text-xs font-semibold text-brand-600">{proximity.label}</p>
            <p className="mt-1 text-sm font-medium text-ink">{proximity.event.title}</p>
            <p className="mt-0.5 text-xs text-ink-soft">{formatEventWhen(proximity.event, timeZone)}</p>
          </div>
        )}

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
                      href={buildGoogleCalendarAccountUrl(accountEmail, event.htmlLink)}
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

function getUpcomingProximity(events: CalendarEvent[], now: number): { event: CalendarEvent; label: string } | null {
  for (const event of events) {
    if (event.allDay) continue;
    const startMs = Date.parse(event.start);
    if (!Number.isFinite(startMs)) continue;
    const minutes = Math.ceil((startMs - now) / 60_000);
    if (minutes < -5 || minutes > 60) continue;

    if (minutes <= 0) return { event, label: 'Começando agora' };
    if (minutes === 1) return { event, label: 'Próximo compromisso em 1 minuto' };
    return { event, label: `Próximo compromisso em ${minutes} minutos` };
  }

  return null;
}

function getFocusGuidance(
  events: CalendarEvent[],
  now: number,
  focusTitle: string | null,
): { label: string; detail: string } | null {
  const focus = focusTitle?.trim();
  if (!focus) return null;

  for (const event of events) {
    if (event.allDay) continue;

    const startMs = Date.parse(event.start);
    if (!Number.isFinite(startMs)) continue;
    const endMs = event.end ? Date.parse(event.end) : Number.NaN;

    if (startMs <= now && Number.isFinite(endMs) && endMs > now) {
      const remaining = Math.max(1, Math.ceil((endMs - now) / 60_000));
      return {
        label: 'Compromisso em andamento',
        detail: `${event.title} termina em cerca de ${remaining} min. Depois, retome: ${focus}.`,
      };
    }

    if (startMs > now) {
      const minutes = Math.ceil((startMs - now) / 60_000);

      if (minutes <= 10) {
        return {
          label: 'Prepare-se para o próximo compromisso',
          detail: `${event.title} começa em cerca de ${minutes} min. Evite iniciar uma tarefa longa agora.`,
        };
      }

      if (minutes < 30) {
        return {
          label: 'Janela curta agora',
          detail: `Você tem cerca de ${minutes} min até ${event.title}. Use esse tempo para uma etapa pequena de: ${focus}.`,
        };
      }

      if (minutes <= 480) {
        return {
          label: 'Bloco recomendado agora',
          detail: `Você tem cerca de ${minutes} min até ${event.title}. Avance primeiro: ${focus}.`,
        };
      }

      break;
    }
  }

  return {
    label: 'Bloco recomendado agora',
    detail: `Sem compromisso próximo bloqueando seu foco. Avance primeiro: ${focus}.`,
  };
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
