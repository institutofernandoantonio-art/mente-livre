import 'server-only';

import type { StructuredIntent } from './types';
import { createConversationState } from './state';
import { buildProposedAction } from './proposed-action';
import type { ProposedAction } from './proposed-action';
import { createProposalState, type ProposalState } from './proposal-state';
import { resolveClarificationTurn } from './orchestration';
import {
  getRuntimeState,
  replaceRuntimeState,
  advanceRuntimeState,
  consumeRuntimeState,
} from './runtime-state-storage';
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
// (`intent`/`now`/`expirations` e `answer`/`now`/`expirations`), nada
// exposto só para viabilizar teste — a infraestrutura de teste (ver
// `tests/support/`) resolve isso inteiramente por fora deste arquivo, via
// um hook de resolução de módulos do Node que redireciona, só durante os
// testes, `./runtime-state-storage`/`./orchestration` para dublês —
// código de produção nunca muda de forma para acomodar um test runner.
//
// --- `ConversationExpirations`: dois TTLs, nunca um só ---------------------
//
// Correção de um gap real identificado no mapeamento da subfase anterior:
// um único `expiresAt` não consegue expressar simultaneamente a política
// V1 (24h para clarificação, 30min para proposta — ver
// conversation-ttl.ts), porque QUAL dos dois caminhos será tomado só é
// decidido DEPOIS que o argumento já foi passado (o resultado de
// `createConversationState`/`evaluateClarification`/orchestration só é
// conhecido em runtime). `conversation-turn.ts` continua sem saber nada
// sobre a POLÍTICA em si — não importa `conversation-ttl.ts`, não calcula
// nada, só recebe os dois timestamps absolutos já prontos do caller (a
// futura camada de entry/dispatcher) e escolhe o campo certo para cada
// chamada de construtor, exatamente como já fazia com um valor só.
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
// --- CONSUME: terminal sem sucessor (correção do gap de residual) ---------
//
// Gap real identificado e corrigido nesta subfase: três status produzidos
// dentro de `resolveClarificationConversationalTurn` são SEMANTICAMENTE
// TERMINAIS — nenhuma resposta futura do usuário pode transformar o MESMO
// `pendingIntent` já persistido em algo materializável sem um novo turno
// de NLU — mas antes desta correção eram devolvidos sem nenhuma escrita,
// deixando a clarification row intacta (até 24h de TTL) e fazendo TODA
// mensagem seguinte continuar sendo tratada como resposta à mesma pergunta
// zumbi, mesmo sendo um pedido novo e completamente não relacionado:
//
// - orchestration `unsupported` (nenhum resolver para o `field` pendente,
//   ou uma referência estruturalmente impossível — ver orchestration.ts);
// - builder `unsupported` (`buildProposedAction`: `intentType` que nunca
//   materializa, ex. `conversational_question`);
// - builder `not_materializable` (`buildProposedAction`: `create_task` com
//   `temporalWindow`/`deadline`/`duration` não resolvidos o suficiente).
//
// Os três agora chamam `consumeRuntimeState(expectedStateId, now)` — o
// MESMO `expectedStateId` já obtido do `getRuntimeState(now)` desta mesma
// execução, nunca um novo id gerado/aceito/relido — antes de retornar,
// via o helper `consumeAndReturn` abaixo. Resultado externo em caso de
// sucesso (`consumed`) permanece EXATAMENTE o status terminal original
// (`unsupported`/`not_materializable`) — o consume nunca é revelado ao
// chamador. `conflict` (outra requisição já avançou/consumiu a mesma row
// entre a leitura e este ponto) e `error` seguem a mesma disciplina
// anti-TOCTOU já usada em `translateAdvanceResult`: zero retry, zero
// requery, zero fallback para `replace`.
//
// NUNCA consomem (permanecem exatamente como antes desta correção,
// porque uma resposta futura genuinamente pode mudar o resultado):
// `ambiguous`, `unrecognized`, `reference_not_found` (not_found da
// Reference Resolution), `error` (falha técnica, não terminal de
// domínio). `awaiting_clarification` e `ready` -> `proposed` continuam
// usando exclusivamente `advanceRuntimeState` — nunca consomem, porque
// ambos têm um PRÓXIMO estado real a persistir.
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

// `ConversationExpirations`: só os dois timestamps absolutos — nunca
// `userId`/`stateId`/`proposalId`/client/payload de runtime. Quem monta
// este objeto (a futura camada de entry) é responsável por gerá-los (ex.:
// via `getClarificationExpiresAt(now)`/`getProposalExpiresAt(now)` de
// conversation-ttl.ts) — este módulo só consome.
export type ConversationExpirations = {
  clarificationExpiresAt: number;
  proposalExpiresAt: number;
};

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
  expirations: ConversationExpirations,
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

  const conversationState = createConversationState(intent, now, expirations.clarificationExpiresAt);

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
      const proposalState: ProposalState = createProposalState(
        buildResult.action,
        proposalId,
        now,
        expirations.proposalExpiresAt,
      );
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
  expirations: ConversationExpirations,
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
  const turnResult = await resolveClarificationTurn(
    current.value.state,
    answer,
    now,
    expirations.clarificationExpiresAt,
  );

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
      // Terminal — ver "CONSUME: terminal sem sucessor" no cabeçalho.
      return consumeAndReturn(expectedStateId, now, { status: 'unsupported' });

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
          // Terminal — ver "CONSUME: terminal sem sucessor" no cabeçalho.
          return consumeAndReturn(expectedStateId, now, { status: 'unsupported' });
        case 'not_materializable':
          return consumeAndReturn(expectedStateId, now, { status: 'not_materializable' });
        case 'proposed': {
          const proposalId = crypto.randomUUID();
          const proposalState: ProposalState = createProposalState(
            buildResult.action,
            proposalId,
            now,
            expirations.proposalExpiresAt,
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

// Espelha exatamente `translateAdvanceResult` acima, mas para os 3 pontos
// terminais-sem-sucessor documentados em "CONSUME: terminal sem sucessor"
// no cabeçalho do arquivo. `expectedStateId`/`now` são sempre os mesmos já
// recebidos/lidos por `resolveClarificationConversationalTurn` nesta
// execução — nunca um novo id gerado, aceito de fora, ou relido. `onSuccess`
// é o status terminal ORIGINAL (`unsupported`/`not_materializable`), devolvido
// só quando o consume de fato remove a row — nunca revela ao chamador que um
// consume aconteceu. `conflict`/`error` nunca disparam retry, requery, ou
// fallback para `replace`/`advance` — mesma disciplina anti-TOCTOU.
async function consumeAndReturn(
  expectedStateId: string,
  now: number,
  onSuccess: ClarificationTurnPersistenceResult,
): Promise<ClarificationTurnPersistenceResult> {
  const consumeResult = await consumeRuntimeState(expectedStateId, now);
  switch (consumeResult.status) {
    case 'consumed':
      return onSuccess;
    case 'conflict':
      return { status: 'conflict' };
    case 'error':
      return { status: 'error' };
  }
}
