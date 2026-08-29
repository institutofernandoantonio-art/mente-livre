import type { ProposalState } from './proposal-state';

// ============================================================================
// Confirmation Policy — "essa resposta confirma ou cancela a proposta
// pendente?"
//
// Nome do arquivo espelha deliberadamente `clarification.ts` (não
// `clarification-policy.ts`) — o padrão real do repo nomeia os arquivos
// pelo substantivo do domínio, mesmo quando a prosa/comentários chamam o
// módulo de "Policy". `confirmation.ts`, não `confirmation-policy.ts`.
//
// Recebe uma `ProposalState` JÁ EM MÃOS (já lida e validada por quem
// chama) e uma resposta textual — esta camada nunca busca a proposta,
// nunca decide se ela ainda é a atual, nunca faz CAS, nunca consome a
// runtime row. Isso é responsabilidade de uma futura integração
// persistente (bloqueada nesta subfase, ver relatório de mapeamento da
// subfase anterior — a ordem confirm→consume→execute vs
// confirm→execute→consume ainda não foi decidida).
//
// `confirmed` aqui significa SOMENTE "a resposta textual foi interpretada
// como confirmação" — nunca autorização para consumir a proposta, nunca
// autorização para executar `ProposedAction`, nunca uma ação em si. Mesmo
// tipo de garantia (e mesma ausência de garantia) que `status: 'ready'`
// já tem em clarification.ts e `status: 'resolved'` em
// answer-resolution.ts.
//
// Alta precisão, não alto recall — mesmo princípio já usado em
// answer-resolution.ts, aqui com ainda mais força: confirmar/cancelar uma
// proposta tem consequência real (a futura criação de uma tarefa), então
// preferimos `unrecognized` a adivinhar. Vocabulário fechado, full-match
// sempre (`Set.has` sobre a resposta inteira normalizada) — nunca
// startsWith/includes/substring: "sim, mas muda para sexta" e "não, cria
// outra" NÃO podem ser classificados pela primeira palavra.
//
// Zero side effects, zero I/O, zero Date.now(), zero dependência de
// Next.js/Supabase/server-only/Google/Anthropic. Mesmo input, sempre
// mesmo output. Não muta `proposalState`: apenas interpreta, nunca chama
// `cancelProposalState`/atualiza `status`/gera nova identidade — o ciclo
// de vida da `ProposalState` continua sendo responsabilidade de outra
// camada.
// ============================================================================

export type ProposalConfirmationResult =
  | { status: 'confirmed' }
  | { status: 'cancelled' }
  | { status: 'ambiguous' }
  | { status: 'unrecognized' }
  | { status: 'expired' };

// trim + lowercase + colapso de espaços, mesma base de
// answer-resolution.ts. Acrescenta remoção de pontuação terminal simples
// (`.`/`!`/`?`/`,`/`;`, com ou sem espaço antes) — diferente de
// duração/hora, uma confirmação em linguagem natural frequentemente vem
// como uma frase curta com pontuação ("sim!", "não."). Não normaliza
// acentos com uma lib genérica (nenhuma outra camada do projeto faz isso)
// — as poucas palavras do vocabulário abaixo que têm acento aparecem
// explicitamente nas duas formas (com e sem acento).
function normalizeAnswer(answer: string): string {
  return answer
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*[.!?,;]+$/u, '');
}

// --- Vocabulário de confirmação ------------------------------------------
//
// Avaliada e reduzida a partir da lista-base proposta na subfase: removidas
// "pode" (sozinha, sem "fazer", é genérica demais — poderia ser um
// truncamento de "pode ser que sim", que é hesitação, não confirmação) e
// "certo" (mais próxima de "entendi"/"compreendi" do que de uma
// autorização clara — ambígua demais para este vocabulário fechado).
const CONFIRMATION_PHRASES: ReadonlySet<string> = new Set([
  'sim',
  'pode fazer',
  'confirma',
  'confirmado',
  'ok',
  'okay',
  'beleza',
  'manda',
  'faz isso',
  'faça isso',
  'positivo',
]);

// --- Vocabulário de cancelamento -----------------------------------------
//
// Removida "deixa" (sozinha) da lista-base: poderia ser início de "deixa
// eu pensar" (hesitação) ou até "deixa assim mesmo" (confirmação) —
// mantidas só as formas completas e idiomaticamente inequívocas de
// desistência ("deixa pra lá"/"deixa para lá").
const CANCELLATION_PHRASES: ReadonlySet<string> = new Set([
  'não',
  'nao',
  'cancela',
  'deixa pra lá',
  'deixa para lá',
  'esquece',
  'não quero mais',
  'nao quero mais',
  'melhor não',
  'melhor nao',
]);

// --- Vocabulário de ambiguidade -------------------------------------------
//
// `ambiguous` significa: a resposta claramente fala sobre decidir, mas não
// fornece uma decisão suficientemente clara — diferente de `unrecognized`,
// que não fala sobre decidir coisa nenhuma.
const AMBIGUOUS_PHRASES: ReadonlySet<string> = new Set([
  'talvez',
  'não sei',
  'nao sei',
  'espera',
  'acho que sim',
  'tanto faz',
]);

// `proposalState` já traz `proposalId`/`action` embutidos — nenhum dos
// dois é recebido separadamente aqui, e nenhum é necessário para decidir
// confirmação/cancelamento (a decisão depende só do TEXTO da resposta).
// Nunca recebe `stateId`/`userId`/claims/cliente Supabase/payload de
// banco — essa fronteira pertence à futura integração persistente, não à
// interpretação semântica pura.
export function resolveProposalConfirmation(
  proposalState: ProposalState,
  answer: string,
  now: number,
): ProposalConfirmationResult {
  // Defesa em profundidade: o storage já filtra expiração antes de
  // qualquer leitura chegar até aqui (ver runtime-state-storage.ts), mas
  // esta função não confia nisso — mesmo princípio já aplicado em
  // orchestration.ts (isConversationStateExpired verificado de novo, sem
  // assumir que quem chamou já verificou). Checagem sempre primeiro,
  // antes de qualquer interpretação de texto.
  if (now >= proposalState.expiresAt) {
    return { status: 'expired' };
  }

  const normalized = normalizeAnswer(answer);

  // Full-match sempre — nunca startsWith/includes/substring. "sim, mas
  // muda para sexta" não está em CONFIRMATION_PHRASES como frase inteira,
  // então cai corretamente em `unrecognized`, nunca em `confirmed`.
  if (CONFIRMATION_PHRASES.has(normalized)) {
    return { status: 'confirmed' };
  }
  if (CANCELLATION_PHRASES.has(normalized)) {
    return { status: 'cancelled' };
  }
  if (AMBIGUOUS_PHRASES.has(normalized)) {
    return { status: 'ambiguous' };
  }

  return { status: 'unrecognized' };
}
