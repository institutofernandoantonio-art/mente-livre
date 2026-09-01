import 'server-only';

import { createClient } from '../supabase/server';

// ============================================================================
// Calendar event claim — o wrapper fino que encapsula a chamada à RPC
// atômica `public.claim_calendar_event_execution`
// (supabase/migrations/20260901100000_create_calendar_event_executions.sql).
//
// Módulo IRMÃO de `local-task-execution.ts` — mesmo padrão, adaptado para
// Calendar, com uma diferença deliberada: NÃO recebe/envia `now`. Subfase
// 3 da criação de compromissos no Google Calendar: prepara claim/
// idempotência da execução, mas NUNCA chama o Google Calendar
// (`events.insert` continua não implementado em `../google/calendar`).
// Este módulo NÃO é chamado por `proposal-turn.ts` ainda — isso é wiring
// de uma subfase futura e separada.
//
// lifecycle: um claim bem-sucedido NUNCA apaga a ProposalState
// correspondente em `conversation_runtime_states` — ela permanece
// disponível até uma futura `finalize_calendar_event_execution` (ainda
// não implementada) consumi-la, depois que o Google confirmar a criação
// do evento. Ver a migration para o racional completo desta correção.
//
// --- Por que este módulo não recebe `now` (diferente de
// ExecuteCreateLocalTaskInput) --------------------------------------------
//
// A auditoria desta subfase confirmou que a RPC pública é alcançável
// diretamente por qualquer sessão `authenticated` via Data API — um
// `p_now` controlado pelo chamador decidindo uma checagem de expiração é
// uma fronteira de confiança errada (permitiria fazer uma proposta já
// expirada parecer válida). A expiração agora é decidida pelo `now()` do
// próprio Postgres, dentro da transação — nunca por um valor vindo daqui.
// `confirm_create_local_task` ainda tem o padrão antigo (`p_now` recebido)
// — dívida registrada, não corrigida nesta subfase (ver relatório
// correspondente), para não misturar uma correção de trust boundary com
// uma RPC já em produção para create_local_task.
//
// Este módulo NUNCA:
// - decide se uma proposta foi confirmada/cancelada — isso é
//   `confirmation.ts`, uma camada completamente diferente;
// - lê/interpreta ConversationState/ProposalState/StoredRuntimeState —
//   recebe só os campos já extraídos e validados por quem chama (nunca
//   `raw ProposalState`, nunca payload JSON bruto, nunca o `event` do
//   `ProposedAction`);
// - aceita `userId`, e-mail, claims, ou um client Supabase de fora — a RPC
//   deriva a identidade via `auth.uid()` na própria sessão do usuário
//   atual, propagada automaticamente pelo client server-side normal (mesmo
//   `createClient()` de `../supabase/server` já usado por
//   `local-task-execution.ts`) — nunca `createAdminClient()`/service role;
// - aceita, gera ou envia `now`/`google_event_id` — a RPC deriva o id
//   sozinha, sempre a partir de `p_proposal_id`, e decide expiração com o
//   relógio do próprio banco, nunca de um valor pronto vindo de fora;
// - insere diretamente em `calendar_event_executions` ou em
//   `conversation_runtime_states` — a ÚNICA operação de I/O aqui é
//   `supabase.rpc('claim_calendar_event_execution', ...)`;
// - faz uma segunda consulta para "explicar" um `conflict` — mesma
//   disciplina anti-TOCTOU já aplicada em toda a pilha: `conflict` é
//   terminal, nunca dispara retry/fallback/reinterpretação;
// - vaza `message`/`details`/`hint`/`code`/stack do erro do Supabase — só
//   o status técnico `error` cruza esta fronteira;
// - usa `console.*` — mesma disciplina de privacidade do resto da pilha;
// - chama o Google Calendar diretamente ou importa `../google/calendar`.
// ============================================================================

// --- Validação mínima de boundary (mesmo padrão de local-task-execution.ts) -

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// --- Validação defensiva do retorno da RPC ------------------------------
//
// Mesma disciplina de "aceitar ou rejeitar, nunca corrigir/coagir" já
// usada em local-task-execution.ts/runtime-state-validation.ts. Qualquer
// desvio de shape colapsa em `error`, nunca é "corrigido" para `claimed`.

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

// Formato exato produzido pela RPC (ver migration): 32 caracteres
// hexadecimais em minúsculas — nunca revalida a DERIVAÇÃO em si (isso
// pertence só à função SQL, única fonte de verdade), só a FORMA do valor
// devolvido.
const GOOGLE_EVENT_ID_PATTERN = /^[0-9a-f]{32}$/;
function isValidGoogleEventId(value: unknown): value is string {
  return typeof value === 'string' && GOOGLE_EVENT_ID_PATTERN.test(value);
}

function parseClaimResult(data: unknown): CalendarEventClaimResult {
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
  if (!hasExactKeys(row, ['status', 'google_event_id'])) {
    return { status: 'error' };
  }

  if (row.status === 'claimed') {
    if (!isValidGoogleEventId(row.google_event_id)) {
      return { status: 'error' };
    }
    return { status: 'claimed', googleEventId: row.google_event_id };
  }

  if (row.status === 'already_claimed') {
    if (!isValidGoogleEventId(row.google_event_id)) {
      return { status: 'error' };
    }
    return { status: 'already_claimed', googleEventId: row.google_event_id };
  }

  if (row.status === 'conflict') {
    if (row.google_event_id !== null) {
      return { status: 'error' };
    }
    return { status: 'conflict' };
  }

  // `status` não é nenhum dos três conhecidos — a migration nunca deveria
  // devolver isso; tratado como inconsistência extraordinária, nunca
  // assumido como um dos casos conhecidos.
  return { status: 'error' };
}

// --- API pública -----------------------------------------------------------

export type CalendarEventClaimResult =
  | { status: 'claimed'; googleEventId: string }
  | { status: 'already_claimed'; googleEventId: string }
  | { status: 'conflict' }
  | { status: 'error' };

// Objeto nomeado (não posicional): mesmo racional já documentado em
// ExecuteCreateLocalTaskInput (local-task-execution.ts) — `expectedStateId`
// e `proposalId` são ambos strings opacas; um objeto nomeado elimina por
// construção o risco de troca posicional entre os dois. Deliberadamente
// SEM `now` — ver cabeçalho do arquivo.
export type ClaimCalendarEventExecutionInput = {
  expectedStateId: string;
  proposalId: string;
};

export async function claimCalendarEventExecution(
  input: ClaimCalendarEventExecutionInput,
): Promise<CalendarEventClaimResult> {
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
  // local-task-execution.ts/runtime-state-storage.ts.
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('claim_calendar_event_execution', {
    p_expected_state_id: expectedStateId,
    p_proposal_id: proposalId,
  });

  if (error) {
    // Nenhum detalhe do erro do Supabase (message/details/hint/code)
    // cruza esta fronteira — só o status técnico.
    return { status: 'error' };
  }

  return parseClaimResult(data);
}
