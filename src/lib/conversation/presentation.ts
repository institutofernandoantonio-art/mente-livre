'use server';

import { getRuntimeState } from './runtime-state-storage';
import type { ProposedAction } from './proposed-action';

// ============================================================================
// Presentation bootstrap — a Server Function pública e read-only que
// permite a uma futura UI descobrir, na montagem, o que já existe no
// runtime da conversa do usuário atual, sem expor nenhum id interno.
//
// Este arquivo NUNCA:
// - muta nada — chama exatamente `getRuntimeState(now)`, nunca
//   `replaceRuntimeState`/`advanceRuntimeState`/`consumeRuntimeState`;
// - chama o dispatcher (`handleConversationMessage`) ou qualquer turn
//   handler (`resolveFirstConversationalTurn`/
//   `resolveClarificationConversationalTurn`/
//   `resolveProposalConversationalTurn`) — não decide nem avança nenhum
//   turno, só traduz o que já existe;
// - chama NLU (`extractStructuredIntent`) — não entende texto nenhum;
// - chama Confirmation (`resolveProposalConfirmation`) — não interpreta
//   resposta nenhuma;
// - chama Execution (`executeCreateLocalTask`) — não cria nada;
// - autentica diretamente (`createClient`/`getClaims`/`getUser`) —
//   `getRuntimeState` já autentica internamente antes de qualquer query,
//   mesmo boundary já comprovado e reaproveitado por
//   `conversation-entry.ts`/`actions.ts`. Duplicar aqui não adicionaria
//   proteção nenhuma;
// - importa Supabase/Google Calendar/Anthropic — nenhuma dessas
//   dependências pertence a esta camada;
// - revalida `ConversationState`/`ProposalState`/`ProposedAction`/
//   `question` — o storage já devolve payload validado
//   (`validateStoredRuntimeState`); esta camada só TRADUZ, nunca
//   reinspeciona a forma do dado.
//
// --- `now`: gerado aqui, e só aqui, nesta camada -------------------------
//
// `Date.now()` é chamado uma única vez, sempre server-side (esta função só
// executa no servidor, por ser uma Server Function — `'use server'`
// acima). O browser nunca fornece `now`: a assinatura pública não tem
// nenhum parâmetro.
//
// --- Catch estreito --------------------------------------------------------
//
// Envolve SOMENTE a chamada a `getRuntimeState` — qualquer exceção
// inesperada vira `{status:'error'}`, igual ao `{status:'error'}` que
// `getRuntimeState` já devolve para toda falha conhecida (auth ausente,
// `now` inválido, erro de storage). Nunca loga erro cru, texto, ou
// qualquer detalhe do Supabase — só o status técnico cruza esta
// fronteira. Sem retry.
//
// --- Dados de apresentação: só o mínimo já aprovado -----------------------
//
// Clarificação: só `state.currentQuestion.text` — nunca
// `missingField`/`pendingIntent`/`createdAt`/`expiresAt`/metadado interno.
// Mesmo campo, mesma extração já usada e auditada em
// `conversation-turn.ts` (`conversationState.currentQuestion.text`).
//
// Proposta: só `state.action` (a própria `ProposedAction`, mesma
// referência já congelada em `createProposalState` — ver
// proposal-state.ts) — nunca `proposalId`/`createdAt`/`expiresAt`.
//
// `stateId` (identidade de storage, usada só para CAS) nunca atravessa
// esta fronteira em nenhuma hipótese — nem para clarificação, nem para
// proposta.
// ============================================================================

export type ConversationPresentationState =
  | { status: 'empty' }
  | { status: 'clarification_required'; question: string }
  | { status: 'proposal_ready'; action: ProposedAction }
  | { status: 'expired' }
  | { status: 'error' };

export async function getConversationPresentationState(): Promise<ConversationPresentationState> {
  const now = Date.now();

  let current;
  try {
    current = await getRuntimeState(now);
  } catch {
    return { status: 'error' };
  }

  switch (current.status) {
    case 'not_found':
      return { status: 'empty' };
    case 'expired':
      return { status: 'expired' };
    case 'error':
      return { status: 'error' };
    case 'found':
      if (current.value.kind === 'clarification') {
        return {
          status: 'clarification_required',
          question: current.value.state.currentQuestion.text,
        };
      }
      // current.value.kind === 'proposal'
      return { status: 'proposal_ready', action: current.value.state.action };
  }
}
