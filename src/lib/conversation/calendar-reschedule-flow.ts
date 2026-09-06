import 'server-only';

import { resolveGoogleCalendarEventTarget } from './calendar-event-target-resolution';
import {
  rescheduleCalendarEventFromSnapshot,
  type CalendarEventRescheduleSnapshot,
} from './calendar-event-reschedule';
import { createConversationState } from './state';
import { advanceRuntimeState, consumeRuntimeState, replaceRuntimeState } from './runtime-state-storage';
import type { StoredRuntimeState } from './runtime-state-validation';
import type { StructuredIntent, TemporalWindow } from './types';
import { getProposalExpiresAt } from './conversation-ttl';
import {
  addCivilDays,
  getCivilDateInTimeZone,
  isValidTimeZone,
  resolveCivilDateTimeInTimeZone,
} from './timezone';
import { getGoogleCalendarEventTargetsInWindow } from '../google/calendar-event-targets';

const PENDING_PREFIX = '__mente_livre_calendar_reschedule_v1__:';
const CLAIMED_PREFIX = '__mente_livre_calendar_reschedule_claimed_v1__:';
const CLAIM_TTL_MS = 60_000;
const MAX_RESCHEDULE_DURATION_MS = 24 * 60 * 60_000;

type RescheduleIntent = Extract<StructuredIntent, { intentType: 'reschedule_event' }>;

type CalendarRescheduleEntryResult =
  | { status: 'clarification_required'; question: string }
  | { status: 'cancelled' }
  | { status: 'needs_input' }
  | { status: 'conflict' }
  | { status: 'error' };

export type StartCalendarRescheduleResult = CalendarRescheduleEntryResult;

export type HandleCalendarRescheduleRuntimeResult =
  | { status: 'not_applicable' }
  | { status: 'handled'; result: CalendarRescheduleEntryResult };

// Primeira versão deliberadamente conservadora: exige que o texto identifique
// o dia ORIGINAL (hoje/amanhã) antes de "para" e que a NLU tenha resolvido o
// NOVO horário como relative_day com hora. O evento real é resolvido ao vivo,
// mas o googleEventId nunca é persistido no runtime nem mostrado à UI.
export async function startCalendarReschedule(
  intent: RescheduleIntent,
  originalText: string,
  now: number,
  timeZone: string,
): Promise<StartCalendarRescheduleResult> {
  if (!Number.isSafeInteger(now) || !isValidTimeZone(timeZone)) {
    return { status: 'error' };
  }

  const sourceWindow = buildSourceWindowBeforePara(originalText);
  if (sourceWindow === null) {
    return {
      status: 'clarification_required',
      question: 'Para remarcar com segurança, diga se o compromisso atual é hoje ou amanhã e para qual novo horário deseja mover.',
    };
  }

  const destinationStart = resolveDestinationStart(intent.temporalWindow, new Date(now), timeZone);
  if (destinationStart === null) {
    return {
      status: 'clarification_required',
      question: 'Por enquanto, informe o novo horário como hoje ou amanhã com hora exata, por exemplo: “para hoje às 16h”.',
    };
  }

  const resolution = await resolveGoogleCalendarEventTarget(
    intent.eventReference,
    sourceWindow,
    now,
    timeZone,
  );

  switch (resolution.status) {
    case 'ambiguous':
      return {
        status: 'clarification_required',
        question: 'Encontrei mais de um compromisso com essa descrição nesse dia. Use um nome mais específico para eu não alterar o evento errado.',
      };
    case 'not_found':
      return {
        status: 'clarification_required',
        question: 'Não encontrei um compromisso único com esse nome no dia informado. Confira o nome e tente novamente.',
      };
    case 'permissions':
      return {
        status: 'clarification_required',
        question: 'Para remarcar compromissos, reconecte seu Google Agenda permitindo alterações e depois repita o pedido.',
      };
    case 'unsupported_window':
    case 'unsupported_reference':
      return {
        status: 'clarification_required',
        question: 'Não consegui identificar esse compromisso com segurança. Informe o nome do evento e se ele é hoje ou amanhã.',
      };
    case 'unavailable':
    case 'error':
      return { status: 'error' };
    case 'resolved':
      break;
  }

  const target = resolution.target;
  if (target.allDay || target.end === null) {
    return {
      status: 'clarification_required',
      question: 'Por enquanto, a remarcação automática funciona apenas para compromissos com horário de início e fim.',
    };
  }

  const originalStartMs = Date.parse(target.start);
  const originalEndMs = Date.parse(target.end);
  const durationMs = originalEndMs - originalStartMs;
  if (
    !Number.isFinite(originalStartMs) ||
    !Number.isFinite(originalEndMs) ||
    durationMs <= 0 ||
    durationMs > MAX_RESCHEDULE_DURATION_MS
  ) {
    return {
      status: 'clarification_required',
      question: 'Não consegui preservar a duração desse compromisso com segurança. Altere esse evento diretamente no Google Agenda.',
    };
  }

  const newStart = destinationStart.toISOString();
  const newEnd = new Date(destinationStart.getTime() + durationMs).toISOString();

  if (newStart === target.start && newEnd === target.end) {
    return {
      status: 'clarification_required',
      question: 'Esse compromisso já está exatamente nesse horário.',
    };
  }

  // Verificação de disponibilidade antes da proposta. O próprio evento alvo
  // é ignorado pelo id somente dentro desta fronteira server-side.
  const destinationLookup = await getGoogleCalendarEventTargetsInWindow(
    newStart,
    newEnd,
    timeZone,
    10,
  );
  switch (destinationLookup.status) {
    case 'permissions':
      return {
        status: 'clarification_required',
        question: 'A autorização do Google Agenda precisa ser renovada antes de remarcar.',
      };
    case 'unavailable':
    case 'error':
      return { status: 'error' };
    case 'ok':
      break;
  }

  if (destinationLookup.events.some((event) => event.googleEventId !== target.googleEventId)) {
    return {
      status: 'clarification_required',
      question: 'Já existe outro compromisso nesse novo horário. Escolha outro horário para remarcar.',
    };
  }

  const snapshot: CalendarEventRescheduleSnapshot = {
    title: target.title,
    originalStart: target.start,
    originalEnd: target.end,
    newStart,
    newEnd,
    allDay: false,
    timeZone,
  };

  const expiresAt = getProposalExpiresAt(now);
  const pendingIntent: RescheduleIntent = {
    missingFields: ['event_reference'],
    confidence: 1,
    intentType: 'reschedule_event',
    eventReference: {
      kind: 'existing_reference',
      raw: encodeSnapshot(PENDING_PREFIX, snapshot),
      resolvedId: null,
    },
    temporalWindow: intent.temporalWindow,
    calendarAction: 'reschedule',
  };

  const baseState = createConversationState(pendingIntent, now, expiresAt);
  if (baseState === null) {
    return { status: 'error' };
  }

  const question = buildConfirmationQuestion(snapshot);
  const state = {
    ...baseState,
    currentQuestion: { field: 'event_reference' as const, text: question },
  };

  const saved = await replaceRuntimeState({ kind: 'clarification', state }, now);
  return saved.status === 'saved'
    ? { status: 'clarification_required', question }
    : { status: 'error' };
}

export async function handleCalendarRescheduleRuntime(
  stored: StoredRuntimeState,
  answer: string,
  now: number,
): Promise<HandleCalendarRescheduleRuntimeResult> {
  if (stored.kind !== 'clarification' || stored.state.pendingIntent.intentType !== 'reschedule_event') {
    return { status: 'not_applicable' };
  }

  const raw = stored.state.pendingIntent.eventReference.raw;
  if (raw.startsWith(CLAIMED_PREFIX)) {
    return { status: 'handled', result: { status: 'conflict' } };
  }
  if (!raw.startsWith(PENDING_PREFIX)) {
    return { status: 'not_applicable' };
  }

  const snapshot = decodeSnapshot(raw, PENDING_PREFIX);
  if (snapshot === null) {
    return { status: 'handled', result: { status: 'error' } };
  }

  const confirmation = classifyRescheduleConfirmation(answer);
  if (confirmation === 'unknown') {
    return { status: 'handled', result: { status: 'needs_input' } };
  }

  if (confirmation === 'no') {
    const consumed = await consumeRuntimeState(stored.stateId, now);
    if (consumed.status === 'consumed') {
      return { status: 'handled', result: { status: 'cancelled' } };
    }
    return {
      status: 'handled',
      result: consumed.status === 'conflict' ? { status: 'conflict' } : { status: 'error' },
    };
  }

  const claimedExpiresAt = now + CLAIM_TTL_MS;
  if (!Number.isSafeInteger(claimedExpiresAt)) {
    return { status: 'handled', result: { status: 'error' } };
  }

  const claimedState = {
    ...stored.state,
    pendingIntent: {
      ...stored.state.pendingIntent,
      eventReference: {
        ...stored.state.pendingIntent.eventReference,
        raw: encodeSnapshot(CLAIMED_PREFIX, snapshot),
      },
    },
    currentQuestion: {
      field: 'event_reference' as const,
      text: 'Remarcação em processamento.',
    },
    expiresAt: claimedExpiresAt,
  };

  const claim = await advanceRuntimeState(stored.stateId, { kind: 'clarification', state: claimedState }, now);
  if (claim.status !== 'advanced') {
    return {
      status: 'handled',
      result: claim.status === 'conflict' ? { status: 'conflict' } : { status: 'error' },
    };
  }

  const result = await rescheduleCalendarEventFromSnapshot(snapshot);
  const claimedStateId = claim.value.stateId;

  switch (result.status) {
    case 'updated':
      await consumeRuntimeState(claimedStateId, now);
      return {
        status: 'handled',
        result: {
          status: 'clarification_required',
          question: 'Compromisso remarcado no Google Agenda.',
        },
      };
    case 'not_found':
      await consumeRuntimeState(claimedStateId, now);
      return {
        status: 'handled',
        result: {
          status: 'clarification_required',
          question: 'O compromisso original mudou ou não existe mais. Faça o pedido novamente para eu conferir o estado atual da agenda.',
        },
      };
    case 'ambiguous':
      await consumeRuntimeState(claimedStateId, now);
      return {
        status: 'handled',
        result: {
          status: 'clarification_required',
          question: 'Não consegui revalidar um único compromisso para remarcar. Faça o pedido novamente.',
        },
      };
    case 'conflict':
      await consumeRuntimeState(claimedStateId, now);
      return {
        status: 'handled',
        result: {
          status: 'clarification_required',
          question: 'O novo horário ficou ocupado antes da confirmação. Escolha outro horário e faça o pedido novamente.',
        },
      };
    case 'authorization_required':
      await consumeRuntimeState(claimedStateId, now);
      return {
        status: 'handled',
        result: {
          status: 'clarification_required',
          question: 'A autorização do Google Agenda precisa ser renovada. Reconecte a agenda e repita o pedido.',
        },
      };
    case 'unsupported':
      await consumeRuntimeState(claimedStateId, now);
      return {
        status: 'handled',
        result: {
          status: 'clarification_required',
          question: 'Não consegui validar essa remarcação com segurança. Faça o pedido novamente.',
        },
      };
    case 'error':
      await consumeRuntimeState(claimedStateId, now);
      return { status: 'handled', result: { status: 'error' } };
  }
}

function buildSourceWindowBeforePara(text: string): TemporalWindow | null {
  const normalized = stripDiacritics(text.toLowerCase());
  const paraMatches = [...normalized.matchAll(/\bpara\b/g)];
  const lastPara = paraMatches.at(-1);
  if (!lastPara || lastPara.index === undefined) return null;

  const sourcePart = normalized.slice(0, lastPara.index);
  const hasToday = /\bhoje\b/.test(sourcePart);
  const hasTomorrow = /\bamanha\b/.test(sourcePart) && !/\bdepois de amanha\b/.test(sourcePart);
  const hasOtherDayReference =
    /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|semana|proxim[oa]|ontem|depois)\b|\d{1,2}\/\d{1,2}|\bdia\s+\d{1,2}\b/.test(
      sourcePart,
    );

  let day: 'today' | 'tomorrow';
  if (hasToday && !hasTomorrow) {
    day = 'today';
  } else if (hasTomorrow && !hasToday && !hasOtherDayReference) {
    day = 'tomorrow';
  } else {
    return null;
  }

  return {
    expression: text.slice(0, lastPara.index),
    resolved: {
      kind: 'relative_day',
      day,
      time: extractClockTime(sourcePart),
    },
  };
}

function resolveDestinationStart(
  temporalWindow: TemporalWindow,
  now: Date,
  timeZone: string,
): Date | null {
  const resolved = temporalWindow.resolved;
  if (resolved.kind !== 'relative_day' || resolved.time === null) return null;

  const today = getCivilDateInTimeZone(now, timeZone);
  const civilDate = resolved.day === 'today' ? today : addCivilDays(today, 1);
  const instant = resolveCivilDateTimeInTimeZone(
    civilDate.year,
    civilDate.month,
    civilDate.day,
    resolved.time.hour,
    resolved.time.minute,
    timeZone,
  );

  return instant.status === 'resolved' ? instant.utc : null;
}

function extractClockTime(normalizedText: string): { hour: number; minute: number } | null {
  const hourMinute = [...normalizedText.matchAll(/\b([01]?\d|2[0-3])h([0-5]\d)\b/g)].at(-1);
  const colon = [...normalizedText.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)].at(-1);
  const bareHour = [...normalizedText.matchAll(/\b([01]?\d|2[0-3])h(?!\d)/g)].at(-1);
  const match = hourMinute ?? colon ?? bareHour;
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: match[2] === undefined ? 0 : Number(match[2]),
  };
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function classifyRescheduleConfirmation(answer: string): 'yes' | 'no' | 'unknown' {
  const normalized = stripDiacritics(answer.trim().toLowerCase()).replace(/\s+/g, ' ');
  const yes = new Set([
    'sim',
    'confirmo',
    'pode remarcar',
    'sim pode remarcar',
    'sim, pode remarcar',
    'confirmar remarcacao',
  ]);
  const no = new Set([
    'nao',
    'nao remarcar',
    'deixa pra la',
    'deixe pra la',
    'remarcar nao',
  ]);

  if (yes.has(normalized)) return 'yes';
  if (no.has(normalized)) return 'no';
  return 'unknown';
}

function buildConfirmationQuestion(snapshot: CalendarEventRescheduleSnapshot): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: snapshot.timeZone,
  });
  const original = formatter.format(new Date(snapshot.originalStart));
  const destination = formatter.format(new Date(snapshot.newStart));
  return `Encontrei “${snapshot.title}” em ${original}. Posso remarcar para ${destination}? Responda “sim” ou “não”.`;
}

function encodeSnapshot(prefix: string, snapshot: CalendarEventRescheduleSnapshot): string {
  return `${prefix}${JSON.stringify(snapshot)}`;
}

function decodeSnapshot(raw: string, prefix: string): CalendarEventRescheduleSnapshot | null {
  if (!raw.startsWith(prefix)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(prefix.length));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const expected = ['allDay', 'newEnd', 'newStart', 'originalEnd', 'originalStart', 'timeZone', 'title'].sort();
  if (keys.length !== expected.length || !expected.every((key, index) => keys[index] === key)) return null;

  if (typeof value.title !== 'string' || value.title.trim().length === 0 || value.title.length > 180) return null;
  if (value.allDay !== false) return null;
  if (typeof value.timeZone !== 'string' || !isValidTimeZone(value.timeZone)) return null;
  for (const key of ['originalStart', 'originalEnd', 'newStart', 'newEnd'] as const) {
    if (typeof value[key] !== 'string' || Number.isNaN(Date.parse(value[key]))) return null;
  }

  return {
    title: value.title,
    originalStart: value.originalStart as string,
    originalEnd: value.originalEnd as string,
    newStart: value.newStart as string,
    newEnd: value.newEnd as string,
    allDay: false,
    timeZone: value.timeZone,
  };
}
