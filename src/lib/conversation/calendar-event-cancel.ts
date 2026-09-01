import 'server-only';

import { createClient } from '../supabase/server';

// ============================================================================
// Calendar event cancel — o wrapper fino que encapsula a chamada à RPC
// atômica `public.cancel_calendar_event_proposal`
// (supabase/migrations/20260901120000_add_cancel_calendar_event_proposal.sql).
//
// Módulo IRMÃO de `calendar-event-claim.ts`/`calendar-event-finalize.ts` —
// mesmo padrão exato. Subfase 5 da criação de compromissos no Google
// Calendar: cancelamento protegido de uma ProposalState
// `create_calendar_event`, para que um "não" do usuário nunca apague a
// runtime nem responda "cancelado" depois que um claim já tenha vencido.
// Este módulo NUNCA chama o Google Calendar, NUNCA cancela um evento real,
// NUNCA chama claim/finalize.
//
// --- Por que este módulo existe (não usar consumeRuntimeState aqui) ------
//
// `consumeRuntimeState` (runtime-state-storage.ts) continua o caminho
// correto para `create_local_task` — cancelamento nunca dispara efeito
// externo naquele caso, então CAS simples sobre a runtime já é suficiente.
// Para `create_calendar_event`, "ler execution, depois consumir runtime"
// como duas operações TypeScript teria uma corrida real (ver cabeçalho da
// migration para a prova dos dois interleavings) — por isso a decisão
// inteira ("ainda posso cancelar" vs. "a execução já começou") precisa
// acontecer atomicamente dentro de uma única RPC Postgres, nunca dividida
// entre uma pré-leitura aqui e uma escrita depois.
//
// Este módulo NUNCA:
// - decide se uma proposta foi confirmada/cancelada — isso é
//   `confirmation.ts`, uma camada completamente diferente;
// - lê/interpreta ConversationState/ProposalState/StoredRuntimeState —
//   recebe só os campos já extraídos e validados por quem chama;
// - aceita `userId`, e-mail, claims, ou um client Supabase de fora — a RPC
//   deriva a identidade via `auth.uid()` na própria sessão do usuário
//   atual, propagada automaticamente pelo client server-side normal (mesmo
//   `createClient()` de `../supabase/server` já usado por
//   `calendar-event-claim.ts`/`calendar-event-finalize.ts`) — nunca
//   `createAdminClient()`/service role;
// - aceita, gera ou envia `now`/`google_event_id`/payload/tokens — a RPC
//   decide expiração com o relógio do próprio banco e nunca precisa de
//   conteúdo do evento para decidir entre os três status;
// - insere/atualiza/apaga diretamente em `calendar_event_executions` ou em
//   `conversation_runtime_states` — a ÚNICA operação de I/O aqui é
//   `supabase.rpc('cancel_calendar_event_proposal', ...)`;
// - faz uma segunda consulta para "explicar" um `conflict` — mesma
//   disciplina anti-TOCTOU já aplicada em toda a pilha: `conflict` é
//   terminal, nunca dispara retry/fallback/reinterpretação;
// - vaza `message`/`details`/`hint`/`code`/stack do erro do Supabase — só
//   o status técnico `error` cruza esta fronteira;
// - usa `console.*` — mesma disciplina de privacidade do resto da pilha;
// - chama o Google Calendar diretamente ou importa `../google/calendar`;
// - chama `claimCalendarEventExecution`/`finalizeCalendarEventExecution` —
//   este módulo é irmão dos outros dois, nunca os invoca.
// ============================================================================

// --- Validação mínima de boundary (mesmo padrão dos módulos irmãos) --------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// --- Validação defensiva do retorno da RPC ------------------------------
//
// Mesma disciplina de "aceitar ou rejeitar, nunca corrigir/coagir" já
// usada em calendar-event-claim.ts/calendar-event-finalize.ts. Qualquer
// desvio de shape colapsa em `error`, nunca é "corrigido" para
// `cancelled`.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const objKeys = Object.keys(obj);
  if (objKeys.length !== keys.length) {
    return false;
  }
  return keys.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

function parseCancelResult(data: unknown): CalendarEventCancelResult {
  if (!Array.isArray(data)) {
    return { status: 'error' };
  }
  if (data.length !== 1) {
    return { status: 'error' };
  }

  const row = data[0];
  if (!isPlainObject(row)) {
    return { status: 'error' };
  }
  if (!hasExactKeys(row, ['status'])) {
    return { status: 'error' };
  }

  if (row.status === 'cancelled') {
    return { status: 'cancelled' };
  }

  if (row.status === 'execution_started') {
    return { status: 'execution_started' };
  }

  if (row.status === 'conflict') {
    return { status: 'conflict' };
  }

  // `status` não é nenhum dos três conhecidos — a migration nunca deveria
  // devolver isso; tratado como inconsistência extraordinária, nunca
  // assumido como um dos casos conhecidos.
  return { status: 'error' };
}

// --- API pública -----------------------------------------------------------

export type CalendarEventCancelResult =
  | { status: 'cancelled' }
  | { status: 'execution_started' }
  | { status: 'conflict' }
  | { status: 'error' };

// Objeto nomeado (não posicional): mesmo racional já documentado em
// ClaimCalendarEventExecutionInput/FinalizeCalendarEventExecutionInput.
// Sem `now`/`googleEventId`/payload — ver cabeçalho do arquivo.
export type CancelCalendarEventProposalInput = {
  expectedStateId: string;
  proposalId: string;
};

export async function cancelCalendarEventProposal(
  input: CancelCalendarEventProposalInput,
): Promise<CalendarEventCancelResult> {
  const { expectedStateId, proposalId } = input;

  if (!isNonEmptyString(expectedStateId)) {
    return { status: 'error' };
  }
  if (!isNonEmptyString(proposalId)) {
    return { status: 'error' };
  }

  // Se `createClient()` lançar ou `supabase.rpc(...)` rejeitar por um
  // motivo fora do contrato normal `{data, error}`, a exceção propaga sem
  // ser capturada aqui — mesma convenção já estabelecida em
  // calendar-event-claim.ts/calendar-event-finalize.ts.
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('cancel_calendar_event_proposal', {
    p_expected_state_id: expectedStateId,
    p_proposal_id: proposalId,
  });

  if (error) {
    // Nenhum detalhe do erro do Supabase (message/details/hint/code)
    // cruza esta fronteira — só o status técnico.
    return { status: 'error' };
  }

  return parseCancelResult(data);
}
