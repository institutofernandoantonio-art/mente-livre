import 'server-only';

import { createClient } from '../supabase/server';

// ============================================================================
// Calendar event finalize — o wrapper fino que encapsula a chamada à RPC
// atômica `public.finalize_calendar_event_execution`
// (supabase/migrations/20260901110000_add_finalize_calendar_event_execution.sql).
//
// Módulo IRMÃO de `calendar-event-claim.ts` — mesmo padrão exato,
// adaptado para o passo seguinte do lifecycle. Subfase 4 da criação de
// compromissos no Google Calendar: prepara a finalização atômica da
// execução, mas NUNCA chama o Google Calendar (`events.insert` continua
// não implementado em `../google/calendar`). Este módulo deve ser chamado
// SOMENTE depois que uma futura camada de Google Calendar já souber que o
// evento existe (foi criado agora, ou já existia de uma tentativa
// anterior) — "Google já confirmou; agora finalize localmente com
// segurança". Este módulo NÃO é chamado por `proposal-turn.ts` ainda —
// isso é wiring de uma subfase futura e separada.
//
// lifecycle: uma finalização bem-sucedida (`completed`) consome
// atomicamente a ProposalState em `conversation_runtime_states` — a
// mesma runtime que o claim (`calendar-event-claim.ts`) deliberadamente
// preservou. `already_completed` é o caminho de retry seguro para uma
// resposta HTTP anterior perdida DEPOIS que um finalize já commitou — não
// reescreve nada, não recria a runtime.
//
// --- Por que este módulo, como o claim, não recebe `now` ------------------
//
// Mesma fronteira de confiança do claim: a RPC pública é alcançável
// diretamente por qualquer sessão `authenticated` via Data API. Mas aqui
// vai além disso — a função SQL nem sequer verifica `expires_at`: o claim
// já validou o TTL no seu próprio instante, e finalize nunca revalida
// tempo algum (ver a migration para o exemplo concreto de timing). Um
// `now`/`p_now` aqui não teria nenhum uso real.
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
//   `calendar-event-claim.ts`) — nunca `createAdminClient()`/service role;
// - aceita, gera ou envia `now`/`google_event_id`/payload/tokens — quem
//   chama finalize já tem o `google_event_id` (foi quem acabou de usá-lo
//   para criar o evento no Google); esta função não precisa devolvê-lo;
// - insere/atualiza/apaga diretamente em `calendar_event_executions` ou em
//   `conversation_runtime_states` — a ÚNICA operação de I/O aqui é
//   `supabase.rpc('finalize_calendar_event_execution', ...)`;
// - faz uma segunda consulta para "explicar" um `conflict` — mesma
//   disciplina anti-TOCTOU já aplicada em toda a pilha: `conflict` é
//   terminal, nunca dispara retry/fallback/reinterpretação;
// - vaza `message`/`details`/`hint`/`code`/stack do erro do Supabase — só
//   o status técnico `error` cruza esta fronteira;
// - usa `console.*` — mesma disciplina de privacidade do resto da pilha;
// - chama o Google Calendar diretamente ou importa `../google/calendar`.
// ============================================================================

// --- Validação mínima de boundary (mesmo padrão de calendar-event-claim.ts) -

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// --- Validação defensiva do retorno da RPC ------------------------------
//
// Mesma disciplina de "aceitar ou rejeitar, nunca corrigir/coagir" já
// usada em calendar-event-claim.ts. Qualquer desvio de shape colapsa em
// `error`, nunca é "corrigido" para `completed`.

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

function parseFinalizeResult(data: unknown): CalendarEventFinalizeResult {
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

  if (row.status === 'completed') {
    return { status: 'completed' };
  }

  if (row.status === 'already_completed') {
    return { status: 'already_completed' };
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

export type CalendarEventFinalizeResult =
  | { status: 'completed' }
  | { status: 'already_completed' }
  | { status: 'conflict' }
  | { status: 'error' };

// Objeto nomeado (não posicional): mesmo racional já documentado em
// ClaimCalendarEventExecutionInput (calendar-event-claim.ts). Sem `now`
// nem `googleEventId` — ver cabeçalho do arquivo.
export type FinalizeCalendarEventExecutionInput = {
  expectedStateId: string;
  proposalId: string;
};

export async function finalizeCalendarEventExecution(
  input: FinalizeCalendarEventExecutionInput,
): Promise<CalendarEventFinalizeResult> {
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
  // calendar-event-claim.ts.
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('finalize_calendar_event_execution', {
    p_expected_state_id: expectedStateId,
    p_proposal_id: proposalId,
  });

  if (error) {
    // Nenhum detalhe do erro do Supabase (message/details/hint/code)
    // cruza esta fronteira — só o status técnico.
    return { status: 'error' };
  }

  return parseFinalizeResult(data);
}
