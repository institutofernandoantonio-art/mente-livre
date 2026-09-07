import 'server-only';

import { consumeRuntimeState, getRuntimeState } from './runtime-state-storage';
import {
  resolveFirstConversationalTurn,
  resolveClarificationConversationalTurn,
  type FirstTurnResult,
  type ClarificationTurnPersistenceResult,
} from './conversation-turn';
import { resolveProposalConversationalTurn, type ProposalTurnResult } from './proposal-turn';
import { extractStructuredIntent } from './intent-extraction';
import { getClarificationExpiresAt, getProposalExpiresAt } from './conversation-ttl';
import type { ProposedAction } from './proposed-action';
import type { CalendarQueryResult } from './calendar-query';
import { handleCalendarCancellationRuntime, startCalendarCancellation } from './calendar-cancel-flow';
import { handleCalendarRescheduleRuntime, startCalendarReschedule } from './calendar-reschedule-flow';
import { prepareCalendarRescheduleNluInput } from './calendar-reschedule-nlu-input';
import { applyCreateEventDefaults } from './create-event-defaults';
import { normalizeCreateTaskRelativeDay } from './create-task-temporal-normalization';
import { normalizeConversationInput } from './conversation-input-normalization';
import { parseExplicitCreateTaskInput } from './explicit-create-task-input';

export type ConversationEntryResult =
  | { status: 'clarification_required'; question: string }
  | { status: 'proposal_ready'; action: ProposedAction }
  | { status: 'calendar_information'; result: CalendarQueryResult }
  | { status: 'schedule_conflict' }
  | { status: 'calendar_unavailable' }
  | { status: 'confirmed'; itemId: string }
  | { status: 'cancelled' }
  | { status: 'calendar_processing' }
  | { status: 'calendar_event_confirmed' }
  | { status: 'calendar_authorization_required' }
  | { status: 'calendar_execution_uncertain' }
  | { status: 'calendar_finalization_pending' }
  | { status: 'needs_input' }
  | { status: 'unsupported' }
  | { status: 'conflict' }
  | { status: 'expired' }
  | { status: 'error' };

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidNow(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isExplicitNewCommand(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase('pt-BR');
  const calendarCommand = /^(agende|marque|mude|remarque|cancele)\s+\S.{2,}$/u;
  const taskCommand = /^(crie|criar)\s+(?:uma\s+)?tarefa\s*[:\-]?\s+\S.{2,}$/u;
  return calendarCommand.test(normalized) || taskCommand.test(normalized);
}

function translateFirstTurnResult(result: FirstTurnResult): ConversationEntryResult {
  switch (result.status) {
    case 'clarification_saved': return { status: 'clarification_required', question: result.question };
    case 'proposal_saved': return { status: 'proposal_ready', action: result.action };
    case 'calendar_information': return { status: 'calendar_information', result: result.result };
    case 'schedule_conflict': return { status: 'schedule_conflict' };
    case 'calendar_unavailable': return { status: 'calendar_unavailable' };
    case 'already_active': return { status: 'conflict' };
    case 'unsupported':
    case 'not_materializable': return { status: 'unsupported' };
    case 'error': return { status: 'error' };
  }
}

function translateClarificationResult(result: ClarificationTurnPersistenceResult): ConversationEntryResult {
  switch (result.status) {
    case 'clarification_saved': return { status: 'clarification_required', question: result.question };
    case 'proposal_saved': return { status: 'proposal_ready', action: result.action };
    case 'calendar_information': return { status: 'calendar_information', result: result.result };
    case 'schedule_conflict': return { status: 'schedule_conflict' };
    case 'calendar_unavailable': return { status: 'calendar_unavailable' };
    case 'ambiguous':
    case 'unrecognized':
    case 'reference_not_found': return { status: 'needs_input' };
    case 'unsupported':
    case 'not_materializable': return { status: 'unsupported' };
    case 'runtime_expired': return { status: 'expired' };
    case 'proposal_pending':
    case 'no_active_runtime_state':
    case 'conflict': return { status: 'conflict' };
    case 'error': return { status: 'error' };
  }
}

function translateProposalResult(result: ProposalTurnResult): ConversationEntryResult {
  switch (result.status) {
    case 'confirmed': return { status: 'confirmed', itemId: result.itemId };
    case 'cancelled': return { status: 'cancelled' };
    case 'execution_started': return { status: 'calendar_processing' };
    case 'calendar_event_confirmed':
    case 'calendar_authorization_required':
    case 'calendar_execution_uncertain':
    case 'calendar_finalization_pending': return { status: result.status };
    case 'confirmation_ambiguous':
    case 'confirmation_unrecognized': return { status: 'needs_input' };
    case 'runtime_expired': return { status: 'expired' };
    case 'clarification_pending':
    case 'no_active_runtime_state':
    case 'conflict': return { status: 'conflict' };
    case 'error': return { status: 'error' };
  }
}

async function handleFirstMessage(text: string, now: number, timezone: string): Promise<ConversationEntryResult> {
  const explicitTask = parseExplicitCreateTaskInput(text);
  if (explicitTask !== null) {
    const withEventDefaults = applyCreateEventDefaults(explicitTask);
    const intent = normalizeCreateTaskRelativeDay(withEventDefaults, now, timezone);
    const expirations = {
      clarificationExpiresAt: getClarificationExpiresAt(now),
      proposalExpiresAt: getProposalExpiresAt(now),
    };
    const result = await resolveFirstConversationalTurn(intent, now, expirations, timezone);
    return translateFirstTurnResult(result);
  }

  const prepared = prepareCalendarRescheduleNluInput(text);
  const extraction = await extractStructuredIntent(prepared.text, now);

  switch (extraction.status) {
    case 'invalid': return { status: 'needs_input' };
    case 'error': return { status: 'error' };
    case 'extracted': {
      if (prepared.transformed && extraction.intent.intentType !== 'reschedule_event') return { status: 'needs_input' };
      if (extraction.intent.intentType === 'cancel_event') return startCalendarCancellation(extraction.intent, text, now, timezone);
      if (extraction.intent.intentType === 'reschedule_event') return startCalendarReschedule(extraction.intent, text, now, timezone);
      const withEventDefaults = applyCreateEventDefaults(extraction.intent);
      const intent = normalizeCreateTaskRelativeDay(withEventDefaults, now, timezone);
      const expirations = {
        clarificationExpiresAt: getClarificationExpiresAt(now),
        proposalExpiresAt: getProposalExpiresAt(now),
      };
      const result = await resolveFirstConversationalTurn(intent, now, expirations, timezone);
      return translateFirstTurnResult(result);
    }
  }
}

async function interruptPendingStateAndHandleNewCommand(stateId: string, text: string, now: number, timezone: string): Promise<ConversationEntryResult> {
  const consumed = await consumeRuntimeState(stateId, now);
  switch (consumed.status) {
    case 'consumed': return handleFirstMessage(text, now, timezone);
    case 'conflict': return { status: 'conflict' };
    case 'error': return { status: 'error' };
  }
}

export async function handleConversationMessage(text: string, now: number, timezone: string): Promise<ConversationEntryResult> {
  if (!isNonBlankString(text)) return { status: 'needs_input' };
  const normalizedText = normalizeConversationInput(text);
  if (!isNonBlankString(normalizedText)) return { status: 'needs_input' };
  if (!isValidNow(now)) return { status: 'needs_input' };

  const current = await getRuntimeState(now);
  switch (current.status) {
    case 'error': return { status: 'error' };
    case 'found':
      if (isExplicitNewCommand(normalizedText)) {
        return interruptPendingStateAndHandleNewCommand(current.value.stateId, normalizedText, now, timezone);
      }
      if (current.value.kind === 'clarification') {
        const calendarCancellation = await handleCalendarCancellationRuntime(current.value, normalizedText, now);
        if (calendarCancellation.status === 'handled') return calendarCancellation.result;
        const calendarReschedule = await handleCalendarRescheduleRuntime(current.value, normalizedText, now);
        if (calendarReschedule.status === 'handled') return calendarReschedule.result;
        const expirations = {
          clarificationExpiresAt: getClarificationExpiresAt(now),
          proposalExpiresAt: getProposalExpiresAt(now),
        };
        const result = await resolveClarificationConversationalTurn(normalizedText, now, expirations, timezone);
        return translateClarificationResult(result);
      }
      return translateProposalResult(await resolveProposalConversationalTurn(normalizedText, now));
    case 'not_found':
    case 'expired': return handleFirstMessage(normalizedText, now, timezone);
  }
}
