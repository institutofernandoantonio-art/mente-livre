import 'server-only';

import type { StructuredIntent } from './types';
import { createConversationState } from './state';
import { buildProposedAction } from './proposed-action';
import type { ProposedAction } from './proposed-action';
import { createProposalState, type ProposalState } from './proposal-state';
import { resolveClarificationTurn } from './orchestration';
import { getRuntimeState, replaceRuntimeState, advanceRuntimeState } from './runtime-state-storage';
import type { RuntimeStateAdvanceResult } from './runtime-state-storage';

// ============================================================================
// Conversation turn — o integrador que conecta orchestration/proposed-action/
// proposal-state ao storage server-side, para o primeiro turno e para a
// continuação de uma clarificação já ativa.
//
// Nome escolhido deliberadamente distinto de `orchestration.ts` (resolve só
// a LÓGICA de um turno, nunca persiste) e de `runtime-state-storage.ts`
// (persiste só o que já foi decidido, nunca sabe o que é StructuredIntent) —
// "conversation-turn" nomeia exatamente a responsabilidade nova: COORDENAR
// um turno de ponta a ponta (ler → decidir com os módulos puros já
// existentes → persistir via CAS), sem duplicar nenhuma regra deles.
//
// Este módulo NUNCA:
// - decide clarificação (`clarification.ts`, via `createConversationState`/
//   `resolveClarificationTurn`, que já fazem isso);
// - decide materialização de proposta (`proposed-action.ts`);
// - constrói/expira ProposalState sozinho (`proposal-state.ts`);
// - consulta Supabase diretamente — toda persistência passa por
//   `runtime-state-storage.ts`;
// - implementa Confirmation Policy — ao encontrar `kind === 'proposal'`,
//   este módulo PARA ali e devolve `proposal_pending`, nunca interpreta
//   "sim"/"não"/"confirma"/"ok"/"manda"/"faz";
// - implementa Execution — nenhum insert em `items`, nenhuma chamada de
//   Calendar, nenhuma execução de `ProposedAction`. Uma proposta persistida
//   continua sendo só intenção materializada aguardando confirmação futura.
//
// Imports normais e estáticos das dependências reais — sem parâmetro de
// injeção, sem `import()` dinâmico condicionado a ambiente de teste. A
// API pública tem exatamente os argumentos conceituais já aprovados
// (`intent`/`now`/`expiresAt` e `answer`/`now`/`nextExpiresAt`), nada
// exposto só para viabilizar teste — a infraestrutura de teste (ver
// `tests/support/`) resolve isso inteiramente por fora deste arquivo, via
// um hook de resolução de módulos do Node que redireciona, só durante os
// testes, `./runtime-state-storage`/`./orchestration` para dublês —
// código de produção nunca muda de forma para acomodar um test runner.
//
// --- REPLACE vs ADVANCE: regra central herdada do mapeamento anterior -----
//
// Criação inicial (nenhum runtime state ativo: `not_found`/`expired`) usa
// SEMPRE `replaceRuntimeState`. Continuação de um state JÁ ativo (`found`)
// usa SEMPRE `advanceRuntimeState`, nunca `replace` por conveniência — usar
// replace ali jogaria fora a proteção de CAS exatamente no caminho mais
// sensível a concorrência (uma resposta stale de outro device sobrescreveria
// silenciosamente um state mais novo). Nenhuma exceção é implementada aqui.
//
// --- stateId vs proposalId --------------------------------------------
//
// `stateId` (identidade de versão de storage, usada só para CAS) NUNCA é
// gerado aqui — vem exclusivamente do wrapper devolvido por
// `getRuntimeState`, permanece só nesta camada server-side, e nunca faz
// parte de nenhum resultado exposto por este módulo. `proposalId`
// (identidade lógica da proposta, usada pela futura Confirmation Policy) é
// gerado aqui, de forma independente, via `crypto.randomUUID()` — nunca
// reaproveitando o `stateId`.
//
// --- Vocabulário de saída: evitando a colisão `not_found` -------------
//
// `ClarificationTurnPersistenceResult` usa `no_active_runtime_state` para
// "não existe runtime state" (equivalente ao `not_found` de
// `RuntimeStateReadResult`) e `reference_not_found` para "referência a
// evento/tarefa não encontrada" (equivalente ao `not_found` de
// `ClarificationTurnResult`, da Reference Resolution) — os dois nomes de
// `not_found` do resto da pilha nunca aparecem juntos sob o mesmo rótulo
// aqui, exatamente para não confundir um com o outro.
// ============================================================================

// --- Resultados públicos -------------------------------------------------
//
// Dois result types, não um único mega-union: os dois fluxos têm
// vocabulários de saída genuinamente diferentes (ex.: `already_active` só
// faz sentido no primeiro turno; `conflict`/`proposal_pending` só no turno
// de clarificação) — misturar os dois recriaria exatamente o anti-padrão de
// "estados impossíveis por operação" que o resto desta pilha (ver os 4
// result types de runtime-state-storage.ts) já evita deliberadamente.

// `clarification_saved`/`proposal_saved` carregam dado mínimo de
// apresentação — sempre extraído do MESMO objeto em memória que já foi
// (ou está prestes a ser, no mesmo await) persistido, nunca de uma
// releitura de runtime nem de uma reconstrução paralela:
//
// - `question`: `currentQuestion.text` da `ConversationState` recém-
//   criada/avançada. Só a string (nunca o `ClarificationQuestion` inteiro
//   nem `field`) — texto 100% determinístico e genérico por campo (ver
//   clarification-questions.ts: "nunca personalizada com conteúdo do
//   intent... para nunca arriscar vazar conteúdo real"), nunca derivado
//   de dado do usuário. Presente SÓ quando a escrita (`replace`/`advance`)
//   já confirmou sucesso — nunca antecipado, nunca presente em `conflict`.
// - `action`: o próprio `ProposedAction` retornado por
//   `buildProposedAction` (mesma referência que originou a
//   `ProposalState` persistida, nunca reconstruído). Shape real
//   (proposed-action.ts) não contém `proposalId`/`userId`/`stateId`/
//   nenhum identificador interno — só `actionType` e `task` (title/
//   description/deadline/duration), dado de domínio já seguro para uma
//   futura camada de apresentação. Presente SÓ após escrita bem-sucedida.
export type FirstTurnResult =
  | { status: 'clarification_saved'; question: string }
  | { status: 'proposal_saved'; action: ProposedAction }
  | { status: 'already_active' }
  | { status: 'unsupported' }
  | { status: 'not_materializable' }
  | { status: 'error' };

export type ClarificationTurnPersistenceResult =
  | { status: 'clarification_saved'; question: string }
  | { status: 'proposal_saved'; action: ProposedAction }
  | { status: 'no_active_runtime_state' }
  | { status: 'runtime_expired' }
  | { status: 'proposal_pending' }
  | { status: 'ambiguous' }
  | { status: 'unrecognized' }
  | { status: 'reference_not_found' }
  | { status: 'unsupported' }
  | { status: 'not_materializable' }
  | { status: 'conflict' }
  | { status: 'error' };

// --- Primeiro turno (sem runtime state ainda) -------------------------

// Nunca aceita userId/claims/Supabase client/stateId externo.
export async function resolveFirstConversationalTurn(
  intent: StructuredIntent,
  now: number,
  expiresAt: number,
): Promise<FirstTurnResult> {
  const current = await getRuntimeState(now);
  if (current.status === 'error') {
    return { status: 'error' };
  }
  if (current.status === 'found') {
    // Já existe runtime state ativo — nunca sobrescrever silenciosamente,
    // nunca usar replace por conveniência (ver REPLACE vs ADVANCE acima).
    return { status: 'already_active' };
  }
  // current.status é 'not_found' ou 'expired': nada ativo a preservar —
  // criação inicial usa replace.

  const conversationState = createConversationState(intent, now, expiresAt);

  if (conversationState !== null) {
    const saved = await replaceRuntimeState({ kind: 'clarification', state: conversationState }, now);
    return saved.status === 'saved'
      ? { status: 'clarification_saved', question: conversationState.currentQuestion.text }
      : { status: 'error' };
  }

  // createConversationState devolveu null: a intenção já está `ready`.
  const buildResult = buildProposedAction(intent);

  switch (buildResult.status) {
    case 'unsupported':
      return { status: 'unsupported' };
    case 'not_materializable':
      return { status: 'not_materializable' };
    case 'proposed': {
      const proposalId = crypto.randomUUID();
      const proposalState: ProposalState = createProposalState(buildResult.action, proposalId, now, expiresAt);
      const saved = await replaceRuntimeState({ kind: 'proposal', state: proposalState }, now);
      return saved.status === 'saved'
        ? { status: 'proposal_saved', action: buildResult.action }
        : { status: 'error' };
    }
  }
}

// --- Turno de clarificação (runtime state já ativo) ---------------------

export async function resolveClarificationConversationalTurn(
  answer: string,
  now: number,
  nextExpiresAt: number,
): Promise<ClarificationTurnPersistenceResult> {
  const current = await getRuntimeState(now);

  switch (current.status) {
    case 'error':
      return { status: 'error' };
    case 'not_found':
      return { status: 'no_active_runtime_state' };
    case 'expired':
      return { status: 'runtime_expired' };
    case 'found':
      break;
  }

  if (current.value.kind === 'proposal') {
    // Confirmation Policy ainda não existe. Este integrador NUNCA
    // interpreta resposta contra uma proposta pendente — para aqui,
    // sem chamar resolveClarificationTurn, sem consumir, sem executar.
    return { status: 'proposal_pending' };
  }

  const expectedStateId = current.value.stateId;
  const turnResult = await resolveClarificationTurn(current.value.state, answer, now, nextExpiresAt);

  switch (turnResult.status) {
    case 'expired':
      // Estruturalmente inalcançável quando o mesmo `now` é usado tanto no
      // getRuntimeState acima quanto aqui (mesmo `expiresAt` do storage e
      // do domínio) — tratado com o mesmo status de storage por segurança,
      // nunca ignorado nem transformado em outra coisa.
      return { status: 'runtime_expired' };

    case 'ambiguous':
      return { status: 'ambiguous' };

    case 'unrecognized':
      return { status: 'unrecognized' };

    case 'not_found':
      // not_found AQUI é da Reference Resolution (referência a
      // evento/tarefa não encontrada) — nunca confundir com
      // 'no_active_runtime_state' acima.
      return { status: 'reference_not_found' };

    case 'unsupported':
      return { status: 'unsupported' };

    case 'error':
      return { status: 'error' };

    case 'awaiting_clarification': {
      const advanceResult = await advanceRuntimeState(
        expectedStateId,
        { kind: 'clarification', state: turnResult.state },
        now,
      );
      return translateAdvanceResult(advanceResult, {
        status: 'clarification_saved',
        question: turnResult.state.currentQuestion.text,
      });
    }

    case 'ready': {
      const buildResult = buildProposedAction(turnResult.intent);

      switch (buildResult.status) {
        case 'unsupported':
          return { status: 'unsupported' };
        case 'not_materializable':
          return { status: 'not_materializable' };
        case 'proposed': {
          const proposalId = crypto.randomUUID();
          const proposalState: ProposalState = createProposalState(
            buildResult.action,
            proposalId,
            now,
            nextExpiresAt,
          );
          const advanceResult = await advanceRuntimeState(
            expectedStateId,
            { kind: 'proposal', state: proposalState },
            now,
          );
          return translateAdvanceResult(advanceResult, {
            status: 'proposal_saved',
            action: buildResult.action,
          });
        }
      }
    }
  }
}

// Traduz o resultado genérico de uma escrita CAS para o vocabulário deste
// módulo. `onSuccess` já vem pronto de quem chama (com `question`/`action`
// extraídos do MESMO objeto que acabou de ser passado para o `advance`) —
// só é devolvido no ramo `advanced`; `conflict`/`error` nunca carregam
// `question`/`action`, mesmo que já tenham sido computados em memória
// antes desta chamada. `conflict` nunca dispara fallback para replace,
// nunca uma segunda escrita, nunca uma re-query só para explicar a causa
// (ver mapeamento da subfase anterior — risco de TOCTOU) — qualquer
// ProposalState/ConversationState construída apenas em memória até este
// ponto é simplesmente descartada.
function translateAdvanceResult(
  result: RuntimeStateAdvanceResult,
  onSuccess: ClarificationTurnPersistenceResult,
): ClarificationTurnPersistenceResult {
  switch (result.status) {
    case 'advanced':
      return onSuccess;
    case 'conflict':
      return { status: 'conflict' };
    case 'error':
      return { status: 'error' };
  }
}
