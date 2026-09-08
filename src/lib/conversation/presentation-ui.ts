import type { ProposedAction } from './proposed-action';
import type { ConversationPresentationState } from './presentation';
import type { ConversationEntryResult } from './conversation-entry';
import type { CalendarQueryResult } from './calendar-query';
import type { TaskPriorityBucket } from './task-priority-command';

export type UiMessageContent =
  | { role: 'user'; kind: 'text'; text: string }
  | { role: 'assistant'; kind: 'text'; text: string }
  | { role: 'assistant'; kind: 'proposal'; action: ProposedAction };

const EXPIRED_TEXT = 'O contexto anterior expirou. Envie sua mensagem novamente para começar de novo.';
const GENERIC_ERROR_TEXT = 'Algo deu errado. Tente novamente.';
const CONFIRMED_TEXT = 'Tarefa criada.';
const CANCELLED_TEXT = 'Proposta cancelada.';
const NEEDS_INPUT_TEXT = 'Não entendi. Pode responder de outro jeito?';
const UNSUPPORTED_TEXT = 'Por enquanto, consigo criar tarefas simples a partir do que você escreve.';
const CONFLICT_TEXT = 'O estado da conversa mudou. Revise o que está na tela e envie novamente.';
const TASK_REFERENCE_NOT_FOUND_TEXT = 'Não encontrei uma tarefa pendente com esse nome.';
const TASK_REFERENCE_AMBIGUOUS_TEXT = 'Encontrei mais de uma tarefa parecida. Diga o nome com mais detalhes.';
const CALENDAR_DAY_BUSY_TEXT = 'Você tem compromissos nesse dia.';
const CALENDAR_HOUR_BUSY_TEXT = 'Esse horário está ocupado na sua agenda.';
const CALENDAR_DAY_AVAILABLE_TEXT = 'Não encontrei horários ocupados nesse dia.';
const CALENDAR_HOUR_AVAILABLE_TEXT = 'Não encontrei compromisso nesse horário.';
const CALENDAR_UNSUPPORTED_TEXT = 'Por enquanto, só consigo checar sua agenda para hoje ou amanhã.';
const CALENDAR_ERROR_TEXT = 'Não consegui consultar seu Google Calendar agora.';
const SCHEDULE_CONFLICT_TEXT = 'Você já tem um compromisso nesse horário.';
const CALENDAR_UNAVAILABLE_TEXT = 'Não consegui confirmar sua disponibilidade agora. Tente novamente.';
const CALENDAR_PROCESSING_TEXT =
  'Esse compromisso já começou a ser processado e não pode mais ser cancelado por aqui.';
const CALENDAR_EVENT_CONFIRMED_TEXT = 'Compromisso adicionado ao Google Agenda, com aviso de 30 minutos antes.';
const CALENDAR_AUTHORIZATION_REQUIRED_TEXT =
  'Para criar esse compromisso, reconecte seu Google Agenda permitindo o agendamento. Depois, confirme novamente.';
const CALENDAR_EXECUTION_UNCERTAIN_TEXT =
  'Não consegui confirmar a conclusão no Google Agenda. Você pode tentar confirmar novamente; o Mente Livre reutilizará a mesma identificação do compromisso para evitar duplicidade.';
const CALENDAR_FINALIZATION_PENDING_TEXT =
  'O compromisso foi processado no Google Agenda, mas não consegui concluir o registro aqui. Tente confirmar novamente.';

function assistantText(text: string): UiMessageContent {
  return { role: 'assistant', kind: 'text', text };
}

function assistantProposal(action: ProposedAction): UiMessageContent {
  return { role: 'assistant', kind: 'proposal', action };
}

function taskPriorityUpdatedText(bucket: TaskPriorityBucket): string {
  switch (bucket) {
    case 'fazer_hoje': return 'Prioridade atualizada: Fazer hoje.';
    case 'planejar': return 'Prioridade atualizada: Planejar.';
    case 'delegar': return 'Prioridade atualizada: Delegar.';
    case 'depois': return 'Prioridade atualizada: Depois.';
  }
}

type CalendarInformationResult =
  | CalendarQueryResult
  | { status: 'busy'; scope: 'day' | 'hour'; busyBlockCount: number };

function calendarInformationText(result: CalendarInformationResult): string {
  switch (result.status) {
    case 'events': {
      const formatter = new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: result.timeZone,
      });
      const lines = result.events.map((event) => {
        if (event.allDay) return `• Dia inteiro — ${event.title}`;
        const start = new Date(event.start);
        const time = Number.isNaN(start.getTime()) ? 'Horário não disponível' : formatter.format(start);
        return `• ${time} — ${event.title}`;
      });
      const header = result.scope === 'day' ? 'Seus compromissos:' : 'Nesse horário encontrei:';
      return `${header}\n${lines.join('\n')}`;
    }
    case 'busy':
      return result.scope === 'day' ? CALENDAR_DAY_BUSY_TEXT : CALENDAR_HOUR_BUSY_TEXT;
    case 'available':
      return result.scope === 'day' ? CALENDAR_DAY_AVAILABLE_TEXT : CALENDAR_HOUR_AVAILABLE_TEXT;
    case 'unsupported_window':
      return CALENDAR_UNSUPPORTED_TEXT;
    case 'error':
      return CALENDAR_ERROR_TEXT;
  }
}

export function mapPresentationBootstrap(state: ConversationPresentationState): UiMessageContent | null {
  switch (state.status) {
    case 'empty':
      return null;
    case 'clarification_required':
      return assistantText(state.question);
    case 'proposal_ready':
      return assistantProposal(state.action);
    case 'expired':
      return assistantText(EXPIRED_TEXT);
    case 'error':
      return assistantText(GENERIC_ERROR_TEXT);
  }
}

export type EntryResultUiEffect = {
  message: UiMessageContent;
  clearInput: boolean;
};

export function mapEntryResultToUiEffect(result: ConversationEntryResult): EntryResultUiEffect {
  switch (result.status) {
    case 'clarification_required':
      return { message: assistantText(result.question), clearInput: true };
    case 'proposal_ready':
      return { message: assistantProposal(result.action), clearInput: true };
    case 'calendar_information':
      return { message: assistantText(calendarInformationText(result.result)), clearInput: true };
    case 'schedule_conflict':
      return { message: assistantText(SCHEDULE_CONFLICT_TEXT), clearInput: true };
    case 'calendar_unavailable':
      return { message: assistantText(CALENDAR_UNAVAILABLE_TEXT), clearInput: false };
    case 'confirmed':
      return { message: assistantText(CONFIRMED_TEXT), clearInput: true };
    case 'cancelled':
      return { message: assistantText(CANCELLED_TEXT), clearInput: true };
    case 'calendar_processing':
      return { message: assistantText(CALENDAR_PROCESSING_TEXT), clearInput: true };
    case 'calendar_event_confirmed':
      return { message: assistantText(CALENDAR_EVENT_CONFIRMED_TEXT), clearInput: true };
    case 'calendar_authorization_required':
    case 'calendar_execution_uncertain':
    case 'calendar_finalization_pending':
      return {
        message: assistantText(
          result.status === 'calendar_authorization_required'
            ? CALENDAR_AUTHORIZATION_REQUIRED_TEXT
            : result.status === 'calendar_execution_uncertain'
              ? CALENDAR_EXECUTION_UNCERTAIN_TEXT
              : CALENDAR_FINALIZATION_PENDING_TEXT,
        ),
        clearInput: false,
      };
    case 'task_priority_updated':
      return { message: assistantText(taskPriorityUpdatedText(result.bucket)), clearInput: true };
    case 'task_reference_not_found':
      return { message: assistantText(TASK_REFERENCE_NOT_FOUND_TEXT), clearInput: false };
    case 'task_reference_ambiguous':
      return { message: assistantText(TASK_REFERENCE_AMBIGUOUS_TEXT), clearInput: false };
    case 'needs_input':
      return { message: assistantText(NEEDS_INPUT_TEXT), clearInput: false };
    case 'unsupported':
      return { message: assistantText(UNSUPPORTED_TEXT), clearInput: true };
    case 'conflict':
      return { message: assistantText(CONFLICT_TEXT), clearInput: false };
    case 'expired':
      return { message: assistantText(EXPIRED_TEXT), clearInput: true };
    case 'error':
      return { message: assistantText(GENERIC_ERROR_TEXT), clearInput: false };
  }
}

export function formatDeadlinePreview(deadline: { at: string } | null): string | null {
  if (deadline === null) return null;
  const parsed = new Date(deadline.at);
  if (Number.isNaN(parsed.getTime())) return deadline.at;
  return parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatDurationPreview(duration: { minutes: number } | null): string | null {
  if (duration === null) return null;
  return `${duration.minutes} min`;
}

type ProposedCalendarEvent = Extract<ProposedAction, { actionType: 'create_calendar_event' }>['event'];

export type EventProposalPreview = {
  title: string;
  description: string | null;
  reminderMinutes: number;
} & (
  | { dateSpan: 'same_day'; date: string; timeRange: string }
  | { dateSpan: 'crosses_midnight'; startText: string; endText: string }
);

export function buildEventProposalPreview(event: ProposedCalendarEvent): EventProposalPreview {
  const start = new Date(event.start);
  const end = new Date(event.end);

  const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: event.timezone,
  });
  const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: event.timezone,
  });

  const startDateText = dateFormatter.format(start);
  const endDateText = dateFormatter.format(end);
  const startTimeText = timeFormatter.format(start);
  const endTimeText = timeFormatter.format(end);
  const description = event.description !== null && event.description.trim().length > 0 ? event.description : null;
  const base = { title: event.title, description, reminderMinutes: event.reminderMinutesBeforeStart };

  if (startDateText === endDateText) {
    return { ...base, dateSpan: 'same_day', date: startDateText, timeRange: `${startTimeText} às ${endTimeText}` };
  }

  return {
    ...base,
    dateSpan: 'crosses_midnight',
    startText: `${startDateText} ${startTimeText}`,
    endText: `${endDateText} ${endTimeText}`,
  };
}
