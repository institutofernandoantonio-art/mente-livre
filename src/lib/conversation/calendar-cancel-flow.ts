import 'server-only';

import { buildCalendarEventCancellationProposal } from './calendar-event-cancel-proposal';
import { deleteCalendarEventFromSnapshot, type CalendarEventDeletionSnapshot } from './calendar-event-deletion';
import { createConversationState } from './state';
import { advanceRuntimeState, consumeRuntimeState, replaceRuntimeState } from './runtime-state-storage';
import type { StoredRuntimeState } from './runtime-state-validation';
import type { StructuredIntent, TemporalWindow } from './types';
import { getProposalExpiresAt } from './conversation-ttl';
import { isValidTimeZone } from './timezone';

const PENDING_PREFIX = '__mente_livre_calendar_cancel_v1__:';
const CLAIMED_PREFIX = '__mente_livre_calendar_cancel_claimed_v1__:';
const CLAIM_TTL_MS = 60_000;

type CancelIntent = Extract<StructuredIntent, { intentType: 'cancel_event' }>;

type CalendarCancellationEntryResult =
  | { status: 'clarification_required'; question: string }
  | { status: 'cancelled' }
  | { status: 'needs_input' }
  | { status: 'conflict' }
  | { status: 'error' };

export type StartCalendarCancellationResult = CalendarCancellationEntryResult;

export type HandleCalendarCancellationRuntimeResult =
  | { status: 'not_applicable' }
  | { status: 'handled'; result: CalendarCancellationEntryResult };

// Inicia o cancelamento SOMENTE depois que a NLU já classificou a mensagem
// como cancel_event. O Google id nunca entra no runtime state: a proposta
// pública contém apenas um snapshot mínimo (título/horário/timezone), que é
// revalidado de novo imediatamente antes do DELETE.
export async function startCalendarCancellation(
  intent: CancelIntent,
  originalText: string,
  now: number,
  timeZone: string,
): Promise<StartCalendarCancellationResult> {
  const temporalWindow = buildExplicitCancellationWindow(originalText);
  if (temporalWindow === null) {
    return {
      status: 'clarification_required',
      question: 'Para cancelar com segurança, diga qual compromisso e se ele é hoje ou amanhã. Se souber, inclua também o horário.',
    };
  }

  const proposal = await buildCalendarEventCancellationProposal(
    intent.eventReference,
    temporalWindow,
    now,
    timeZone,
  );

  switch (proposal.status) {
    case 'ambiguous':
      return {
        status: 'clarification_required',
        question: 'Encontrei mais de um compromisso possível. Repita o pedido informando o nome e o horário do compromisso que deseja cancelar.',
      };
    case 'not_found':
      return {
        status: 'clarification_required',
        question: 'Não encontrei um compromisso único com essa descrição. Confira o nome, o dia e o horário e tente novamente.',
      };
    case 'authorization_required':
      return {
        status: 'clarification_required',
        question: 'Para cancelar compromissos, reconecte seu Google Agenda permitindo alterações e depois repita o pedido.',
      };
    case 'unsupported':
      return {
        status: 'clarification_required',
        question: 'Por enquanto, o cancelamento seguro funciona para compromissos de hoje ou amanhã. Informe também o horário quando houver mais de um parecido.',
      };
    case 'error':
      return { status: 'error' };
    case 'proposed':
      break;
  }

  if (proposal.action.event.allDay) {
    return {
      status: 'clarification_required',
      question: 'Por enquanto, não cancelo eventos de dia inteiro automaticamente. Abra o Google Agenda para esse tipo de compromisso.',
    };
  }

  const snapshot: CalendarEventDeletionSnapshot = {
    title: proposal.action.event.title,
    start: proposal.action.event.start,
    end: proposal.action.event.end,
    allDay: false,
    timeZone: proposal.action.event.timeZone,
  };

  const expiresAt = getProposalExpiresAt(now);
  const pendingIntent: CancelIntent = {
    missingFields: ['event_reference'],
    confidence: 1,
    intentType: 'cancel_event',
    eventReference: {
      kind: 'existing_reference',
      raw: encodeSnapshot(PENDING_PREFIX, snapshot),
      resolvedId: null,
    },
    calendarAction: 'cancel',
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

// Intercepta somente o runtime state interno criado por startCalendarCancellation.
// Qualquer outra clarificação continua pertencendo ao fluxo conversacional
// normal. O branch CLAIMED nunca executa DELETE novamente: a rotação de
// state_id por CAS é o claim que impede dois "sim" concorrentes de apagarem
// duas vezes ou de competir com um "não".
export async function handleCalendarCancellationRuntime(
  stored: StoredRuntimeState,
  answer: string,
  now: number,
): Promise<HandleCalendarCancellationRuntimeResult> {
  if (stored.kind !== 'clarification' || stored.state.pendingIntent.intentType !== 'cancel_event') {
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

  const confirmation = classifyDestructiveConfirmation(answer);
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
      text: 'Cancelamento em processamento.',
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

  const deletion = await deleteCalendarEventFromSnapshot(snapshot);
  const claimedStateId = claim.value.stateId;

  switch (deletion.status) {
    case 'deleted':
      // O efeito externo já foi confirmado pelo Google. A limpeza local é
      // best-effort e nunca transforma um DELETE confirmado em "falha".
      await consumeRuntimeState(claimedStateId, now);
      return {
        status: 'handled',
        result: {
          status: 'clarification_required',
          question: 'Compromisso cancelado no Google Agenda.',
        },
      };

    case 'not_found':
      await consumeRuntimeState(claimedStateId, now);
      return {
        status: 'handled',
        result: {
          status: 'clarification_required',
          question: 'O compromisso mudou ou não existe mais. Faça o pedido novamente para eu conferir o estado atual da agenda.',
        },
      };

    case 'ambiguous':
      await consumeRuntimeState(claimedStateId, now);
      return {
        status: 'handled',
        result: {
          status: 'clarification_required',
          question: 'Não consegui revalidar um único compromisso para cancelar. Faça o pedido novamente com nome e horário.',
        },
      };

    case 'authorization_required':
      await consumeRuntimeState(claimedStateId, now);
      return {
        status: 'handled',
        result: {
          status: 'clarification_required',
          question: 'A autorização do Google Agenda precisa ser renovada. Reconecte a agenda e depois repita o pedido.',
        },
      };

    case 'unsupported':
      await consumeRuntimeState(claimedStateId, now);
      return {
        status: 'handled',
        result: {
          status: 'clarification_required',
          question: 'Não consegui validar esse compromisso com segurança para exclusão. Faça o pedido novamente.',
        },
      };

    case 'error':
      await consumeRuntimeState(claimedStateId, now);
      return { status: 'handled', result: { status: 'error' } };
  }
}

function buildExplicitCancellationWindow(text: string): TemporalWindow | null {
  const normalized = stripDiacritics(text.toLowerCase());
  const hasToday = /\bhoje\b/.test(normalized);
  const hasTomorrow = /\bamanha\b/.test(normalized) && !/\bdepois de amanha\b/.test(normalized);
  const hasOtherDayReference =
    /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|semana|proxim[oa]|ontem|depois)\b|\d{1,2}\/\d{1,2}|\bdia\s+\d{1,2}\b/.test(
      normalized,
    );

  const time = extractClockTime(normalized);

  let day: 'today' | 'tomorrow';
  if (hasToday && !hasTomorrow) {
    day = 'today';
  } else if (hasTomorrow && !hasToday && !hasOtherDayReference) {
    day = 'tomorrow';
  } else if (!hasToday && !hasTomorrow && !hasOtherDayReference && time !== null) {
    day = 'today';
  } else {
    return null;
  }

  return {
    expression: text,
    resolved: { kind: 'relative_day', day, time },
  };
}

function extractClockTime(normalizedText: string): { hour: number; minute: number } | null {
  const hourMinute = normalizedText.match(/\b([01]?\d|2[0-3])h([0-5]\d)\b/);
  const colon = normalizedText.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const bareHour = normalizedText.match(/\b([01]?\d|2[0-3])h(?!\d)/);
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

function classifyDestructiveConfirmation(answer: string): 'yes' | 'no' | 'unknown' {
  const normalized = stripDiacritics(answer.trim().toLowerCase()).replace(/\s+/g, ' ');

  const yes = new Set([
    'sim',
    'confirmo',
    'pode cancelar',
    'sim pode cancelar',
    'sim, pode cancelar',
    'confirmar cancelamento',
  ]);
  const no = new Set([
    'nao',
    'nao cancelar',
    'deixa pra la',
    'deixe pra la',
    'cancelar nao',
  ]);

  if (yes.has(normalized)) return 'yes';
  if (no.has(normalized)) return 'no';
  return 'unknown';
}

function buildConfirmationQuestion(snapshot: CalendarEventDeletionSnapshot): string {
  const start = new Date(snapshot.start);
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: snapshot.timeZone,
  });
  const when = Number.isNaN(start.getTime()) ? 'horário informado' : formatter.format(start);
  return `Encontrei “${snapshot.title}” em ${when}. Confirma o cancelamento? Responda “sim” ou “não”.`;
}

function encodeSnapshot(prefix: string, snapshot: CalendarEventDeletionSnapshot): string {
  return `${prefix}${JSON.stringify(snapshot)}`;
}

function decodeSnapshot(raw: string, prefix: string): CalendarEventDeletionSnapshot | null {
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
  const expected = ['allDay', 'end', 'start', 'timeZone', 'title'].sort();
  if (keys.length !== expected.length || !expected.every((key, index) => keys[index] === key)) return null;

  if (typeof value.title !== 'string' || value.title.trim().length === 0 || value.title.length > 180) return null;
  if (typeof value.start !== 'string' || Number.isNaN(Date.parse(value.start))) return null;
  if (value.end !== null && (typeof value.end !== 'string' || Number.isNaN(Date.parse(value.end)))) return null;
  if (value.allDay !== false) return null;
  if (typeof value.timeZone !== 'string' || !isValidTimeZone(value.timeZone)) return null;

  return {
    title: value.title,
    start: value.start,
    end: value.end as string | null,
    allDay: false,
    timeZone: value.timeZone,
  };
}
