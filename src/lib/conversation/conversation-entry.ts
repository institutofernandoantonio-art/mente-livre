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

// ============================================================================
// Conversation entry — o dispatcher server-side único que recebe uma
// mensagem de texto e roteia para EXATAMENTE uma família de turno:
// clarification-turn, proposal-turn, ou NLU+first-turn.
//
// Este é o primeiro módulo desta pilha que CONHECE as três famílias ao
// mesmo tempo — todos os módulos anteriores (conversation-turn.ts,
// proposal-turn.ts, intent-extraction.ts) são deliberadamente cegos uns
// aos outros. Este módulo não duplica nenhuma regra deles: só lê o
// runtime UMA vez para decidir qual família chamar, e traduz o
// vocabulário interno de cada família para um contrato externo mínimo
// (`ConversationEntryResult`).
//
// --- Regra central: zero fallback entre handlers -------------------------
//
// A leitura classificadora deste módulo (`getRuntimeState(now)`) decide
// qual família será chamada — e só isso. Cada handler escolhido faz sua
// PRÓPRIA releitura interna (já testada e aprovada nas subfases
// anteriores) e pode descobrir que o runtime mudou de kind entre as duas
// leituras (`proposal_pending`/`clarification_pending`), que deixou de
// existir (`no_active_runtime_state`/`already_active`), ou que expirou
// nesse intervalo (`runtime_expired`). NENHUM desses sinais autoriza
// chamar outro handler, tentar NLU, ou reler o runtime "para confirmar" —
// todos colapsam num único status externo terminal (`conflict` ou
// `expired`, conforme a seção correspondente abaixo). A classificação
// deste módulo é feita UMA vez por request; o que os handlers descobrem
// depois é deles resolverem, nunca deste dispatcher tentar de novo.
//
// --- Regra formal de autorização de NLU -----------------------------------
//
// `extractStructuredIntent` (IA) só é chamada quando a leitura
// classificadora inicial retornou `not_found` OU `expired` — nunca depois
// de `found` (qualquer kind), nunca depois de `error`, e nunca como
// segunda tentativa após um handler já ter sido escolhido e ter
// retornado qualquer status (incluindo os de corrida acima). Não existe
// exceção a esta regra no código abaixo.
//
// --- `now`: fronteira explícita, documentada aqui de propósito -----------
//
// `handleConversationMessage` é uma função INTERNA e TESTÁVEL — recebe
// `now` como argumento explícito, mesmo princípio de determinismo já
// usado em toda `src/lib/conversation/` (nunca `Date.now()` interno).
// Uma futura Server Action pública (fora do escopo desta subfase) será
// responsável por gerar `Date.now()` no servidor e chamar esta função —
// o browser nunca deve fornecer `now` a essa Server Action, mas essa
// fronteira pertence a um módulo que ainda não existe, não a este.
//
// --- Escolha dos TTLs: só quando o fluxo realmente precisa ----------------
//
// `getClarificationExpiresAt(now)`/`getProposalExpiresAt(now)`
// (conversation-ttl.ts) só são calculados imediatamente antes de uma
// chamada que realmente os usa (`resolveClarificationConversationalTurn`/
// `resolveFirstConversationalTurn`) — nunca antecipados para um caminho
// que pode terminar antes disso (input inválido, GET com erro, proposta
// encontrada, NLU inválido/erro). `resolveProposalConversationalTurn`
// nunca recebe TTL nenhum — não persiste nenhum novo state.
//
// --- `timezone`: contexto do cliente, nunca dado de autorização -----------
//
// Adicionado nesta subfase (query_calendar read-only) — o browser envia o
// timezone real (`Intl.DateTimeFormat().resolvedOptions().timeZone`,
// capturado em `ConversationPanel.tsx`) para que `relative_day` possa ser
// resolvido corretamente (o NLU nunca recebe timezone, só `now` em UTC —
// ver `calendar-query.ts`). Este dispatcher NUNCA valida o timezone nem
// decide com base nele — só repassa o valor cru até a única camada que
// realmente precisa dele (`resolveFirstConversationalTurn`/
// `resolveClarificationConversationalTurn` → `calendar-query.ts`, quando
// e só quando o intent é `query_calendar`). Timezone inválido nunca rejeita
// a mensagem inteira aqui — outras intenções (`create_task` etc.) não usam
// timezone nenhum.
//
// --- Segurança -------------------------------------------------------------
//
// Recebe SÓ `text`/`now`/`timezone` — nunca `userId`/`stateId`/`proposalId`/
// client Supabase/admin/`ConversationState`/`ProposalState` do chamador. Não
// autentica diretamente: cada módulo inferior (runtime-state-storage.ts,
// local-task-execution.ts) já deriva a sessão via seu próprio boundary
// existente. `ConversationEntryResult` nunca expõe `stateId`/`proposalId`
// — só o mínimo de apresentação (`question`/`action`/`itemId`/`result` de
// `calendar_information`, todos já auditados como seguros).
// ============================================================================

export type ConversationEntryResult =
  | { status: 'clarification_required'; question: string }
  | { status: 'proposal_ready'; action: ProposedAction }
  | { status: 'calendar_information'; result: CalendarQueryResult }
  // Subfase 2 da criação de compromissos no Google Calendar:
  // `schedule_conflict` (freeBusy encontrou ocupação na janela exata do
  // ProposedAction) e `calendar_unavailable` (Calendar não conectado ou
  // falha técnica na consulta) — nenhum dos dois carrega dado do Google
  // (nem intervalos, nem tokens); ver conversation-turn.ts para o
  // mapeamento completo.
  | { status: 'schedule_conflict' }
  | { status: 'calendar_unavailable' }
  | { status: 'confirmed'; itemId: string }
  | { status: 'cancelled' }
  | { status: 'needs_input' }
  | { status: 'unsupported' }
  | { status: 'conflict' }
  | { status: 'expired' }
  | { status: 'error' };

// --- Validação mínima de boundary (mesmo padrão do resto da pilha) --------

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidNow(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

// --- Tradução interno -> externo, uma família por vez ---------------------

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
      // Corrida: a leitura classificadora deste dispatcher viu ausência/
      // expiração, mas outra requisição criou um runtime state ativo
      // entre essa leitura e a chamada a first-turn. Zero overwrite já
      // ocorreu dentro de first-turn — aqui só reportamos a corrida.
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
      // Wrong-kind (proposal_pending) ou ausência descoberta só na
      // releitura interna (no_active_runtime_state) — mesma família de
      // corrida que `already_active`/`clarification_pending`: a
      // classificação deste dispatcher ficou stale durante o próprio
      // turno. Nunca reinterpretado como "sem runtime" (o que autorizaria
      // NLU indevidamente) — sempre `conflict`.
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
    case 'confirmation_ambiguous':
    case 'confirmation_unrecognized':
      return { status: 'needs_input' };
    case 'runtime_expired':
      return { status: 'expired' };
    case 'clarification_pending':
    case 'no_active_runtime_state':
    case 'conflict':
      // Mesma família de corrida documentada em translateClarificationResult.
      return { status: 'conflict' };
    case 'error':
      return { status: 'error' };
  }
}

// --- Primeira mensagem: NLU + first-turn -----------------------------------
//
// Só chamado quando a classificação inicial já determinou `not_found`/
// `expired` — nunca chamado de nenhum outro lugar.
async function handleFirstMessage(text: string, now: number, timezone: string): Promise<ConversationEntryResult> {
  const extraction = await extractStructuredIntent(text, now);

  switch (extraction.status) {
    case 'invalid':
      return { status: 'needs_input' };
    case 'error':
      return { status: 'error' };
    case 'extracted': {
      const expirations = {
        clarificationExpiresAt: getClarificationExpiresAt(now),
        proposalExpiresAt: getProposalExpiresAt(now),
      };
      const result = await resolveFirstConversationalTurn(extraction.intent, now, expirations, timezone);
      return translateFirstTurnResult(result);
    }
  }
}

// --- API pública -----------------------------------------------------------

// Nunca aceita userId/stateId/proposalId/client Supabase/admin/
// ConversationState/ProposalState externos — só o texto do usuário e o
// instante do turno (fronteira `now` explicada no cabeçalho do arquivo).
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

  // Única leitura classificadora deste dispatcher — decide SÓ qual
  // família chamar. Nenhuma segunda leitura acontece aqui; cada handler
  // escolhido faz a sua própria, internamente.
  const current = await getRuntimeState(now);

  switch (current.status) {
    case 'error':
      return { status: 'error' };

    case 'found':
      if (current.value.kind === 'clarification') {
        const expirations = {
          clarificationExpiresAt: getClarificationExpiresAt(now),
          proposalExpiresAt: getProposalExpiresAt(now),
        };
        const result = await resolveClarificationConversationalTurn(text, now, expirations, timezone);
        return translateClarificationResult(result);
      }
      // current.value.kind === 'proposal'
      return translateProposalResult(await resolveProposalConversationalTurn(text, now));

    case 'not_found':
    case 'expired':
      return handleFirstMessage(text, now, timezone);
  }
}
