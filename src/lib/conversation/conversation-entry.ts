import 'server-only';

import { getRuntimeState } from './runtime-state-storage';
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

// ============================================================================
// Conversation entry — dispatcher server-side único da conversa.
//
// O fluxo padrão continua dividido em clarification-turn, proposal-turn e
// NLU+first-turn. Ações mutáveis sobre compromissos REAIS do Google Calendar
// (cancelar/remarcar) são interceptadas aqui por fatias especializadas:
// ambas resolvem o alvo sem expor googleEventId e revalidam o evento antes
// da mutação. Este arquivo só roteia; matching, confirmação, CAS e Google
// write vivem nos módulos específicos.
//
// --- Regra central: zero fallback entre handlers -------------------------
//
// A leitura classificadora deste módulo (`getRuntimeState(now)`) decide qual
// família será chamada. Para uma clarification encontrada, os handlers de
// Calendar reconhecem SOMENTE os próprios marcadores internos; qualquer
// outro state devolve `not_applicable` e segue para o fluxo padrão. Nunca há
// NLU/fallback depois de um runtime found.
//
// --- Regra formal de autorização de NLU -----------------------------------
//
// `extractStructuredIntent` (IA) só é chamada quando a leitura inicial
// retornou `not_found` OU `expired` — nunca depois de `found`/`error`, e
// nunca como segunda tentativa após um handler. `cancel_event` e
// `reschedule_event` seguem para suas fatias especializadas sem segunda NLU.
//
// Frases inequívocas de remarcação que contêm horário de origem + destino
// passam antes por `prepareCalendarRescheduleNluInput`: a CÓPIA enviada à
// NLU omite só o horário antigo para que o guard temporal compare o destino
// correto. O texto ORIGINAL continua sendo passado a startCalendarReschedule
// e é a fonte usada para localizar o evento. Se a NLU preparada não voltar
// como reschedule_event, o fluxo falha fechado em `needs_input` e nunca usa
// o texto transformado para outra ação.
//
// --- `now` / timezone -----------------------------------------------------
//
// `now` é recebido explicitamente desta camada interna e o browser nunca o
// fornece. `timezone` vem do browser como contexto civil e nunca como dado
// de identidade/autorização. A validação continua nas camadas que realmente
// usam o valor.
//
// --- Segurança -------------------------------------------------------------
//
// Recebe SÓ `text`/`now`/`timezone` — nunca `userId`/`stateId`/`proposalId`/
// client Supabase/admin. `ConversationEntryResult` nunca expõe ids internos
// nem googleEventId.
// ============================================================================

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

function translateFirstTurnResult(result: FirstTurnResult): ConversationEntryResult {
  switch (result.status) {
    case 'clarification_saved':
      return { status: 'clarification_required', question: result.question };
    case 'proposal_saved':
      return { status: 'proposal_ready', action: result.action };
    case 'calendar_information':
      return { status: 'calendar_information', result: result.result };
    case 'schedule_conflict':
      return { status: 'schedule_conflict' };
    case 'calendar_unavailable':
      return { status: 'calendar_unavailable' };
    case 'already_active':
      return { status: 'conflict' };
    case 'unsupported':
    case 'not_materializable':
      return { status: 'unsupported' };
    case 'error':
      return { status: 'error' };
  }
}

function translateClarificationResult(result: ClarificationTurnPersistenceResult): ConversationEntryResult {
  switch (result.status) {
    case 'clarification_saved':
      return { status: 'clarification_required', question: result.question };
    case 'proposal_saved':
      return { status: 'proposal_ready', action: result.action };
    case 'calendar_information':
      return { status: 'calendar_information', result: result.result };
    case 'schedule_conflict':
      return { status: 'schedule_conflict' };
    case 'calendar_unavailable':
      return { status: 'calendar_unavailable' };
    case 'ambiguous':
    case 'unrecognized':
    case 'reference_not_found':
      return { status: 'needs_input' };
    case 'unsupported':
    case 'not_materializable':
      return { status: 'unsupported' };
    case 'runtime_expired':
      return { status: 'expired' };
    case 'proposal_pending':
    case 'no_active_runtime_state':
    case 'conflict':
      return { status: 'conflict' };
    case 'error':
      return { status: 'error' };
  }
}

function translateProposalResult(result: ProposalTurnResult): ConversationEntryResult {
  switch (result.status) {
    case 'confirmed':
      return { status: 'confirmed', itemId: result.itemId };
    case 'cancelled':
      return { status: 'cancelled' };
    case 'execution_started':
      return { status: 'calendar_processing' };
    case 'calendar_event_confirmed':
    case 'calendar_authorization_required':
    case 'calendar_execution_uncertain':
    case 'calendar_finalization_pending':
      return { status: result.status };
    case 'confirmation_ambiguous':
    case 'confirmation_unrecognized':
      return { status: 'needs_input' };
    case 'runtime_expired':
      return { status: 'expired' };
    case 'clarification_pending':
    case 'no_active_runtime_state':
    case 'conflict':
      return { status: 'conflict' };
    case 'error':
      return { status: 'error' };
  }
}

async function handleFirstMessage(text: string, now: number, timezone: string): Promise<ConversationEntryResult> {
  const prepared = prepareCalendarRescheduleNluInput(text);
  const extraction = await extractStructuredIntent(prepared.text, now);

  switch (extraction.status) {
    case 'invalid':
      return { status: 'needs_input' };
    case 'error':
      return { status: 'error' };
    case 'extracted': {
      // Texto transformado existe SOMENTE para destravar a interpretação do
      // destino em uma remarcação com dois horários. Nunca permitimos que
      // essa cópia gere outra família de ação.
      if (prepared.transformed && extraction.intent.intentType !== 'reschedule_event') {
        return { status: 'needs_input' };
      }

      if (extraction.intent.intentType === 'cancel_event') {
        return startCalendarCancellation(extraction.intent, text, now, timezone);
      }
      if (extraction.intent.intentType === 'reschedule_event') {
        return startCalendarReschedule(extraction.intent, text, now, timezone);
      }

      const expirations = {
        clarificationExpiresAt: getClarificationExpiresAt(now),
        proposalExpiresAt: getProposalExpiresAt(now),
      };
      const result = await resolveFirstConversationalTurn(extraction.intent, now, expirations, timezone);
      return translateFirstTurnResult(result);
    }
  }
}

export async function handleConversationMessage(
  text: string,
  now: number,
  timezone: string,
): Promise<ConversationEntryResult> {
  if (!isNonBlankString(text)) {
    return { status: 'needs_input' };
  }
  if (!isValidNow(now)) {
    return { status: 'needs_input' };
  }

  const current = await getRuntimeState(now);

  switch (current.status) {
    case 'error':
      return { status: 'error' };

    case 'found':
      if (current.value.kind === 'clarification') {
        const calendarCancellation = await handleCalendarCancellationRuntime(current.value, text, now);
        if (calendarCancellation.status === 'handled') {
          return calendarCancellation.result;
        }

        const calendarReschedule = await handleCalendarRescheduleRuntime(current.value, text, now);
        if (calendarReschedule.status === 'handled') {
          return calendarReschedule.result;
        }

        const expirations = {
          clarificationExpiresAt: getClarificationExpiresAt(now),
          proposalExpiresAt: getProposalExpiresAt(now),
        };
        const result = await resolveClarificationConversationalTurn(text, now, expirations, timezone);
        return translateClarificationResult(result);
      }

      return translateProposalResult(await resolveProposalConversationalTurn(text, now));

    case 'not_found':
    case 'expired':
      return handleFirstMessage(text, now, timezone);
  }
}
