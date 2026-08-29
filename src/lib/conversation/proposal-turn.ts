import 'server-only';

import { resolveProposalConfirmation } from './confirmation';
import { getRuntimeState, consumeRuntimeState } from './runtime-state-storage';

// ============================================================================
// Proposal turn — o integrador que conecta a Confirmation Policy pura
// (`confirmation.ts`) ao storage server-side, para uma resposta dirigida a
// uma `ProposalState` pendente.
//
// Nome escolhido para espelhar exatamente `conversation-turn.ts`
// ("<domínio>-turn.ts"): este módulo é um IRMÃO daquele, não uma extensão
// dele — `conversation-turn.ts` continua responsável por primeiro
// turno/clarificação e para em `proposal_pending` ao encontrar uma
// proposta; este módulo começa exatamente onde aquele para. Deliberadamente
// NÃO chamado `execution-*`/`confirm-and-execute` — nada aqui executa
// nenhuma ação, e o nome não deveria sugerir isso.
//
// Este módulo NUNCA:
// - reimplementa a Confirmation Policy — importa e chama
//   `resolveProposalConfirmation` real, nunca duplica vocabulário/
//   normalização/decisão confirmed-vs-cancelled;
// - chama `replaceRuntimeState`/`advanceRuntimeState` — a ÚNICA mutação
//   possível aqui é `consumeRuntimeState`, e só no caminho `cancelled`;
// - executa `ProposedAction` — nenhum insert em `items`, nenhuma chamada
//   de Calendar;
// - aceita `userId`/`stateId`/`proposalId` do chamador — `stateId` vem
//   exclusivamente do MESMO `getRuntimeState(now)` deste turno, nunca do
//   browser.
//
// --- `confirmed` permanece bloqueado nesta subfase ------------------------
//
// Quando a policy retorna `confirmed`, este módulo devolve
// `confirmation_requires_execution` — deliberadamente NÃO `confirmed`
// sozinho, porque isso sugeriria que algum efeito já aconteceu. Nenhuma
// mutação de storage ocorre nesse caminho (nem consume, nem advance, nem
// replace) — a tensão de idempotência entre "consumir antes de executar"
// e "executar antes de consumir" (ver relatório de mapeamento da subfase
// de Confirmation Policy) ainda não foi resolvida, e persistir qualquer
// coisa nesse caminho antes de resolvê-la arriscaria uma proposta
// "confirmada" sem nenhuma garantia real de execução única. Este boundary
// é só um marcador interno — nenhuma mensagem de UI, nenhum "confirmado!"
// deve ser derivado disto enquanto Execution não existir.
//
// --- `cancelled` é o único caminho persistente --------------------------
//
// Cancelamento nunca dispara ação externa, então não carrega a mesma
// tensão de idempotência — `consumeRuntimeState(expectedStateId, now)` já
// oferece toda a garantia necessária (CAS + expiração + proteção contra
// replay, já testadas em runtime-state-storage.ts). `conflict` nunca
// dispara uma segunda tentativa, um fallback para replace, ou uma
// re-query para "explicar" a causa — mesma disciplina já aplicada em
// conversation-turn.ts (risco de TOCTOU).
//
// --- Nuance conhecida do consume -----------------------------------------
//
// `consumeRuntimeState` pode retornar `error` mesmo depois de um DELETE
// físico já ter acontecido, se a linha devolvida falhar na validação
// (ver runtime-state-storage.ts). Este módulo não tenta "resolver" isso —
// não faz re-query, não assume que `error` significa "nada aconteceu",
// só propaga `error` como erro técnico, nunca como `cancelled`.
// ============================================================================

export type ProposalTurnResult =
  | { status: 'no_active_runtime_state' }
  | { status: 'runtime_expired' }
  | { status: 'clarification_pending' }
  | { status: 'confirmation_ambiguous' }
  | { status: 'confirmation_unrecognized' }
  | { status: 'cancelled' }
  | { status: 'confirmation_requires_execution' }
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
  const confirmation = resolveProposalConfirmation(current.value.state, answer, now);

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

    case 'confirmed':
      // BLOQUEADO deliberadamente nesta subfase — ver cabeçalho do
      // arquivo. Nenhuma escrita, nenhuma Execution.
      return { status: 'confirmation_requires_execution' };

    case 'cancelled': {
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
