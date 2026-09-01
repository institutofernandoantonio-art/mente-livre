import 'server-only';

import { resolveProposalConfirmation } from './confirmation';
import { getRuntimeState, consumeRuntimeState } from './runtime-state-storage';
import { executeCreateLocalTask } from './local-task-execution';
import { cancelCalendarEventProposal } from './calendar-event-cancel';
import { confirmCalendarEvent } from './calendar-event-confirmation';

// ============================================================================
// Proposal turn — o integrador que conecta a Confirmation Policy pura
// (`confirmation.ts`) ao storage server-side e, quando a resposta confirma a
// proposta, à Execution atômica (`local-task-execution.ts`), para uma
// resposta dirigida a uma `ProposalState` pendente.
//
// Nome escolhido para espelhar exatamente `conversation-turn.ts`
// ("<domínio>-turn.ts"): este módulo é um IRMÃO daquele, não uma extensão
// dele — `conversation-turn.ts` continua responsável por primeiro
// turno/clarificação e para em `proposal_pending` ao encontrar uma
// proposta; este módulo começa exatamente onde aquele para.
//
// Este módulo NUNCA:
// - reimplementa a Confirmation Policy — importa e chama
//   `resolveProposalConfirmation` real, nunca duplica vocabulário/
//   normalização/decisão confirmed-vs-cancelled;
// - reimplementa Execution — importa e chama `executeCreateLocalTask` real,
//   nunca abre conexão Supabase própria, nunca insere linha diretamente em
//   nenhuma tabela, nunca chama Calendar. Este módulo conhece só a
//   ABSTRAÇÃO `executeCreateLocalTask`, nunca a RPC/Supabase por trás dela;
// - chama `replaceRuntimeState`/`advanceRuntimeState` — nunca existiu
//   necessidade dessas duas operações aqui;
// - chama `consumeRuntimeState` no caminho `confirmed` — a RPC atômica por
//   trás de `executeCreateLocalTask` já faz claim da runtime row + insert
//   em `items` + remoção da runtime row, tudo em UMA transação (ver
//   supabase/migrations/20260826140000_create_confirm_create_local_task_function.sql).
//   Chamar `consumeRuntimeState` aqui, antes ou depois, duplicaria essa
//   garantia com uma segunda operação não-atômica seria com ela — exatamente
//   o risco que a RPC existe para eliminar (ver relatório de mapeamento da
//   subfase de Execution/idempotência). `consumeRuntimeState` continua
//   usado SÓ no caminho `cancelled`, que nunca dispara efeito externo e por
//   isso não carrega essa tensão;
// - aceita `userId`/`stateId`/`proposalId`/`task` do chamador — todos os
//   três vêm exclusivamente do MESMO `getRuntimeState(now)` deste turno,
//   nunca do browser/resposta textual;
// - faz uma segunda consulta para "explicar" um `conflict` — mesma
//   disciplina anti-TOCTOU já aplicada em toda a pilha (ver
//   runtime-state-storage.ts/local-task-execution.ts): `conflict` é
//   terminal, nunca dispara retry/fallback/reinterpretação.
//
// --- `confirmed` executa, de verdade — dois caminhos, por actionType -----
//
// Para `create_local_task`: quando a policy retorna `confirmed`, este
// módulo chama `executeCreateLocalTask` com `expectedStateId` (do
// `getRuntimeState` desta mesma leitura), `proposalId`/`task` (extraídos
// da MESMA `ProposalState` já em mãos) e `now` (o mesmo recebido por esta
// função) — nunca um novo identificador gerado aqui, nunca um novo
// relógio lido. Resultado do wrapper mapeia 1:1: `created` -> `confirmed`
// (com o `itemId` real), `conflict` -> `conflict`, `error` -> `error`.
// Nenhuma mutação de storage própria deste módulo acontece nesse caminho —
// a única operação externa é essa única chamada. Comportamento preservado
// EXATAMENTE como era antes da Subfase 9 — zero mudança.
//
// Para `create_calendar_event` (Subfase 9 — conectar o "sim" ao lifecycle
// seguro): este módulo chama `confirmCalendarEvent`
// (`./calendar-event-confirmation.ts`), o pequeno orquestrador que faz
// claim -> Google `events.insert` -> finalize. `proposal-turn.ts` NUNCA
// reimplementa esses três passos nem chama claim/execução Google/finalize
// diretamente — só a abstração `confirmCalendarEvent`, e só mapeia o
// resultado dela para o vocabulário externo deste módulo
// (`ProposalTurnResult`). Ver `calendar-event-confirmation.ts` para o
// contrato completo (semântica de cada status, prova de race com
// cancelamento, recuperação de resposta perdida).
//
// --- `actionType` não suportada (defensivo, hoje inalcançável) -----------
//
// `ProposedAction` hoje só tem as duas variantes já tratadas acima
// (`create_local_task`/`create_calendar_event`, ver proposed-action.ts) —
// o `if` que verifica `action.actionType` nesse ponto é estruturalmente
// inalcançável enquanto isso for verdade. Mantido mesmo assim como
// invariante explícita: se `ProposedAction` um dia crescer para uma
// terceira variante e este integrador não for atualizado para conhecê-la,
// cair aqui representa uma proposta persistida que este handler não sabe
// executar — uma inconsistência interna real, não um caminho de negócio
// válido. Por isso `error` (nunca um novo status inventado, nunca uma
// tentativa de "adivinhar" a ação, nunca consumo da runtime row, nunca
// chamada a qualquer executor).
//
// --- `cancelled` — dois caminhos, por actionType (Subfase 5) -------------
//
// Para `create_local_task`, cancelamento nunca dispara ação externa, então
// não carrega nenhuma tensão de atomicidade —
// `consumeRuntimeState(expectedStateId, now)` já oferece toda a garantia
// necessária (CAS + expiração + proteção contra replay, já testadas em
// runtime-state-storage.ts). Este caminho é preservado EXATAMENTE como
// era antes desta subfase — zero mudança de comportamento.
//
// Para `create_calendar_event`, cancelamento PODE colidir com uma
// execução já reivindicada por outra camada — apagar a runtime e responder
// "cancelado" depois que uma execução já foi reivindicada seria uma
// mentira ao usuário e um risco real de duplicação/confusão numa futura
// chamada ao Google. `cancelCalendarEventProposal` (`./calendar-event-
// cancel.ts`) resolve isso com UMA RPC Postgres atômica que decide "ainda
// posso cancelar" vs. "a execução já começou" sem nenhuma pré-leitura em
// TypeScript (ver a migration correspondente para a prova dos dois
// interleavings claim-vs-cancel). `execution_started` é um resultado
// NOVO, explícito, nunca traduzido para `cancelled` — mapear os dois para
// o mesmo status externo seria exatamente o "cancelado" falso que esta
// subfase existe para eliminar.
//
// Esta subfase NUNCA chama claim/finalize a partir daqui, e NUNCA executa
// nenhuma escrita no Google Calendar — "não", depois de um claim já
// vencido, só informa que o cancelamento local não é mais seguro.
//
// --- Nuance conhecida do consume -----------------------------------------
//
// `consumeRuntimeState` pode retornar `error` mesmo depois de um DELETE
// físico já ter acontecido, se a linha devolvida falhar na validação (ver
// runtime-state-storage.ts). Este módulo não tenta "resolver" isso — não
// faz re-query, não assume que `error` significa "nada aconteceu", só
// propaga `error` como erro técnico, nunca como `cancelled`.
//
// --- Exceções de dependência ----------------------------------------------
//
// Se `executeCreateLocalTask` (ou `consumeRuntimeState`/`getRuntimeState`)
// lançar uma exceção fora do contrato normal de retorno, ela propaga sem
// ser capturada aqui — mesma convenção já usada por todo o resto deste
// módulo (nenhuma chamada a storage é envolvida em try/catch) e por
// local-task-execution.ts (que também deixa exceções de `createClient()`/
// `supabase.rpc(...)` propagarem). Decisão de consistência, não uma
// omissão: este módulo não inventa uma semântica de erro diferente só
// para esta dependência.
// ============================================================================

export type ProposalTurnResult =
  | { status: 'no_active_runtime_state' }
  | { status: 'runtime_expired' }
  | { status: 'clarification_pending' }
  | { status: 'confirmation_ambiguous' }
  | { status: 'confirmation_unrecognized' }
  | { status: 'cancelled' }
  // Subfase 5 da criação de compromissos no Google Calendar: resultado
  // explícito para "a proposta é create_calendar_event, mas um claim já
  // venceu — o cancelamento local não é mais seguro". Nunca traduzido
  // para `cancelled` nesta camada nem em nenhuma camada superior (ver
  // conversation-entry.ts/presentation-ui.ts).
  | { status: 'execution_started' }
  | { status: 'confirmed'; itemId: string }
  // Subfase 9 da criação de compromissos no Google Calendar: resultados
  // explícitos do lifecycle claim -> Google -> finalize
  // (`calendar-event-confirmation.ts`), mapeados 1:1 a partir de
  // `ConfirmCalendarEventResult`. Nunca reaproveita `confirmed` (que
  // carrega `itemId`, um conceito de `create_local_task`/tabela `items` —
  // create_calendar_event não tem item local nenhum).
  | { status: 'calendar_event_confirmed' }
  | { status: 'calendar_authorization_required' }
  | { status: 'calendar_execution_uncertain' }
  | { status: 'calendar_finalization_pending' }
  | { status: 'conflict' }
  | { status: 'error' };

export async function resolveProposalConversationalTurn(
  answer: string,
  now: number,
): Promise<ProposalTurnResult> {
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

  if (current.value.kind === 'clarification') {
    // Este entrypoint é o espelho de conversation-turn.ts: aquele para em
    // `proposal_pending` ao ver uma proposta; este para aqui ao ver uma
    // clarificação — nenhuma tentativa de interpretar a resposta contra o
    // pendingIntent, nenhuma chamada à Confirmation Policy.
    return { status: 'clarification_pending' };
  }

  const expectedStateId = current.value.stateId;
  const proposalState = current.value.state;
  const confirmation = resolveProposalConfirmation(proposalState, answer, now);

  switch (confirmation.status) {
    case 'expired':
      // Mesma row já foi verificada como não expirada pelo
      // getRuntimeState acima — defesa em profundidade da própria policy
      // (ver confirmation.ts). Reaproveita o mesmo status de storage, sem
      // inventar um terceiro nome para o mesmo conceito.
      return { status: 'runtime_expired' };

    case 'ambiguous':
      return { status: 'confirmation_ambiguous' };

    case 'unrecognized':
      return { status: 'confirmation_unrecognized' };

    case 'confirmed': {
      const action = proposalState.action;

      // Subfase 9: create_calendar_event usa o orquestrador
      // claim -> Google -> finalize. create_local_task continua exatamente
      // como antes, sem nenhuma mudança.
      if (action.actionType === 'create_calendar_event') {
        const confirmationResult = await confirmCalendarEvent({
          expectedStateId,
          proposalId: proposalState.proposalId,
          action,
        });

        switch (confirmationResult.status) {
          case 'completed':
            return { status: 'calendar_event_confirmed' };
          case 'authorization_required':
            return { status: 'calendar_authorization_required' };
          case 'execution_uncertain':
            return { status: 'calendar_execution_uncertain' };
          case 'finalization_pending':
            return { status: 'calendar_finalization_pending' };
          case 'conflict':
            return { status: 'conflict' };
          case 'error':
            return { status: 'error' };
        }
      }

      if (action.actionType !== 'create_local_task') {
        // Ver "actionType não suportada" no cabeçalho — inalcançável hoje,
        // mantido como invariante explícita.
        return { status: 'error' };
      }

      const executionResult = await executeCreateLocalTask({
        expectedStateId,
        proposalId: proposalState.proposalId,
        task: action.task,
        now,
      });

      switch (executionResult.status) {
        case 'created':
          return { status: 'confirmed', itemId: executionResult.itemId };
        case 'conflict':
          return { status: 'conflict' };
        case 'error':
          return { status: 'error' };
      }
    }

    case 'cancelled': {
      const action = proposalState.action;

      // Subfase 5: create_calendar_event usa a RPC atômica de
      // cancelamento protegido — nunca consumeRuntimeState (ver cabeçalho
      // do arquivo para a corrida que isso evitaria). create_local_task
      // continua exatamente como antes, sem nenhuma mudança.
      if (action.actionType === 'create_calendar_event') {
        const cancelResult = await cancelCalendarEventProposal({
          expectedStateId,
          proposalId: proposalState.proposalId,
        });
        switch (cancelResult.status) {
          case 'cancelled':
            return { status: 'cancelled' };
          case 'execution_started':
            return { status: 'execution_started' };
          case 'conflict':
            return { status: 'conflict' };
          case 'error':
            return { status: 'error' };
        }
      }

      const consumeResult = await consumeRuntimeState(expectedStateId, now);
      switch (consumeResult.status) {
        case 'consumed':
          return { status: 'cancelled' };
        case 'conflict':
          return { status: 'conflict' };
        case 'error':
          return { status: 'error' };
      }
    }
  }
}
