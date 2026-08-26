import type { ProposedAction } from './proposed-action';

// ============================================================================
// Proposal state — efêmero, puro, determinístico
//
// Representa só o necessário para manter UMA proposta concreta aguardando
// confirmação: "qual ação foi proposta, sob qual identidade, e até quando
// essa proposta continua válida". Nada além disso.
//
// Não interpreta resposta do usuário, não confirma, não executa, não sabe
// o que é "sim"/"não". A futura Confirmation Policy decide o que uma
// resposta significa; este módulo só guarda/descarta a proposta em si.
//
// EFÊMERO DE PROPÓSITO, mesmo racional de state.ts: nada aqui é
// persistido, logado, serializado para localStorage/sessionStorage ou
// enviado a terceiros — não existe tabela, cache, cookie nem qualquer I/O
// neste arquivo.
//
// Zero side effects, zero rede, zero Date.now()/crypto.randomUUID()
// escondido (todo instante e todo identificador são recebidos
// explicitamente como parâmetro), zero dependência de Next.js/Supabase/
// Anthropic/Google.
// ============================================================================

// Instante sempre como epoch milliseconds (number), nunca ISO string —
// mesma justificativa de EpochMillis em state.ts: a única operação feita
// aqui é comparação numérica (`now >= expiresAt`).
type EpochMillis = number;

// Única forma válida de existir: uma proposta concreta com identidade e
// expiração. Ausência de proposta ativa é representada pelo chamador como
// `null`, nunca por um status dentro do tipo — mesma técnica já usada por
// ConversationState. "status" é mantido como literal só por
// autodocumentação e simetria com `ConversationState.status`, não porque
// haja um segundo valor possível.
//
// Invariante mantida por construção, não pelo compilador: só crie um
// ProposalState através de createProposalState() abaixo — nunca monte o
// objeto à mão.
export type ProposalState = {
  status: 'awaiting_confirmation';
  proposalId: string; // opaco, gerado pelo chamador — nunca por este módulo
  action: ProposedAction; // congelada no momento da proposta, nunca recomputada aqui
  createdAt: EpochMillis; // início real da proposta, nunca recalculado
  expiresAt: EpochMillis; // política de TTL decidida inteiramente pelo chamador
};

// Cria o estado a partir de uma ação já proposta.
//
// `proposalId`/`now`/`expiresAt` são sempre recebidos do chamador, nunca
// gerados aqui: gerar um identificador opaco ou ler o relógio são side
// effects/não-determinismo, o que quebraria a pureza deste módulo e sua
// testabilidade — mesmo racional já aplicado a `now`/`expiresAt` em
// createConversationState().
//
// Sem validação de runtime de `proposalId` vazio ou de `expiresAt <= now`:
// `state.ts` real não valida forma alguma dos valores que recebe (não
// checa se `intent` é bem formado, não relaciona `createdAt`/`expiresAt`
// entre si) — confia estruturalmente na fronteira chamadora. Inventar uma
// validação aqui que não existe no módulo irmão criaria uma inconsistência
// de contrato sem necessidade comprovada, e um `expiresAt` já vencido no
// momento da criação não é um estado inválido: é simplesmente uma proposta
// que `isProposalStateExpired` já classificará corretamente como expirada
// na primeira checagem, sem exigir nenhuma camada extra de validação.
export function createProposalState(
  action: ProposedAction,
  proposalId: string,
  now: EpochMillis,
  expiresAt: EpochMillis,
): ProposalState {
  return {
    status: 'awaiting_confirmation',
    proposalId,
    action,
    createdAt: now,
    expiresAt,
  };
}

// Não recebe `state`: cancelar sempre produz o mesmo resultado,
// independentemente do estado atual — existe como operação nomeada só
// para deixar a intenção explícita em quem chama ("isto é um
// cancelamento", não um `= null` solto e sem contexto), mesmo racional de
// cancelConversationState(). "Deixa pra lá" continua sem ser interpretado
// neste módulo — quem decidir que a frase significa cancelamento chama
// esta função depois de decidir isso, não o contrário.
export function cancelProposalState(): null {
  return null;
}

// Puro: `now` é sempre recebido explicitamente, nunca lido de Date.now()
// internamente — mesmo input, mesmo output, sem relógio global escondido.
// Mesmo boundary de isConversationStateExpired(): `now >= expiresAt`.
//
// Segurança contra confirmação tardia (não implementada aqui, só
// habilitada por este mecanismo): a futura Confirmation Policy deve checar
// isProposalStateExpired() ANTES de tratar qualquer resposta como
// confirmação/rejeição desta proposta — uma proposta expirada nunca deve
// ser confirmada silenciosamente. Nenhuma dessas decisões é tomada aqui.
export function isProposalStateExpired(state: ProposalState, now: EpochMillis): boolean {
  return now >= state.expiresAt;
}
