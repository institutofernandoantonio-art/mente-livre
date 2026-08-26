import type { StructuredIntent } from './types';
import { evaluateClarification } from './clarification';
import { getNextClarificationQuestion, type ClarificationQuestion } from './clarification-questions';

// ============================================================================
// Conversational state — efêmero, puro, determinístico
//
// Representa só o necessário para continuar UMA intenção incompleta ao
// longo de vários turnos: "qual intenção está pendente, e qual é a
// pergunta atual em aberto". Nada além disso.
//
// Não interpreta resposta do usuário, não usa IA, não conhece voz/texto
// como canais diferentes, não autoriza nem executa nada. A futura camada
// que transforma uma resposta em texto ("uma hora") num campo preenchido
// do StructuredIntent fica FORA deste módulo — aqui só existe a
// capacidade de trocar o pendingIntent por uma versão já atualizada
// externamente e recomputar a partir dela.
//
// EFÊMERO DE PROPÓSITO: um StructuredIntent pode conter título, descrição
// e referências textuais do usuário. Nada aqui é persistido, logado,
// serializado para localStorage/sessionStorage ou enviado a terceiros —
// não existe tabela, cache, cookie nem qualquer I/O neste arquivo.
//
// Zero side effects, zero rede, zero Date.now() escondido (todo instante
// de tempo é recebido explicitamente como parâmetro), zero dependência de
// Next.js/Supabase/Anthropic/Google.
// ============================================================================

// Instantes sempre como epoch milliseconds (number), nunca ISO string:
// a única operação feita com eles aqui é comparação numérica
// (`now >= expiresAt`) — não há necessidade de fuso horário nem de
// semântica de "dia civil" (diferente de PlanningWindow, que precisa
// disso); um número evita parsing e mantém a comparação trivial.
type EpochMillis = number;

// Única forma válida de existir: uma intenção pendente com uma pergunta
// em aberto. "idle" (nenhuma conversa pendente) é representado pela
// AUSÊNCIA de ConversationState (null), não por um status dentro do tipo
// — não há necessidade de discriminated union aqui, já que este tipo só
// modela um caso. "status" é mantido como literal só para
// autodocumentação e para não colidir, no futuro, com outros estados
// (ex. 'awaiting_confirmation') que um módulo IRMÃO possa vir a definir.
//
// Invariante mantida por construção, não pelo compilador: só crie/altere
// um ConversationState através de createConversationState()/
// advanceConversationState() abaixo — nunca monte o objeto à mão.
export type ConversationState = {
  status: 'awaiting_clarification';
  pendingIntent: StructuredIntent;
  currentQuestion: ClarificationQuestion;
  createdAt: EpochMillis; // início real da conversa, nunca muda entre turnos
  expiresAt: EpochMillis; // renovado a cada turno por quem chama advance()
};

// Deliberadamente NÃO guarda `missingFields` nem o ClarificationDecision
// inteiro: ambos são 100% recomputáveis a partir de `pendingIntent` via
// evaluateClarification() — guardar uma cópia derivada só criaria uma
// segunda fonte de verdade que poderia divergir da primeira. Só
// `currentQuestion` é mantido explícito, porque É o próprio propósito do
// estado: dizer o que está sendo perguntado agora, sem exigir que quem
// consome o estado re-rode o pipeline de clarificação só para descobrir
// isso.

export type ConversationAdvanceResult =
  | { status: 'ready'; intent: StructuredIntent }
  | { status: 'awaiting_clarification'; state: ConversationState };

// Cria o estado a partir de uma intenção recém-entendida.
//
// `expiresAt` é recebido explicitamente, nunca calculado aqui a partir de
// um TTL fixo embutido — mecanismo (o estado sabe expirar) e política
// (quando exatamente expira) ficam separados de propósito: 15 minutos
// pode fazer sentido para texto e não fazer sentido para um usuário
// falando em movimento, e não há base hoje para fixar isso como parte do
// modelo. Quem chama esta função decide a política.
export function createConversationState(
  intent: StructuredIntent,
  now: EpochMillis,
  expiresAt: EpochMillis,
): ConversationState | null {
  const decision = evaluateClarification(intent);

  if (decision.status === 'ready') {
    return null;
  }

  const currentQuestion = getNextClarificationQuestion(decision);
  if (!currentQuestion) {
    // Estruturalmente inalcançável: `needs_clarification` sempre tem ao
    // menos 1 campo (ClarificationDecision garante isso por tipo), então
    // getNextClarificationQuestion nunca devolve null neste ramo — guarda
    // defensiva, não um caminho real.
    return null;
  }

  return {
    status: 'awaiting_clarification',
    pendingIntent: intent,
    currentQuestion,
    createdAt: now,
    expiresAt,
  };
}

// Substitui o pendingIntent por uma versão já atualizada por uma camada
// externa (ainda não implementada) e reavalia a clarificação do zero.
// Nunca confia no `state` anterior para decidir o que ainda falta — a
// verdade é sempre recomputada a partir de `updatedIntent`, mesmo
// princípio já usado entre StructuredIntent.missingFields e
// evaluateClarification().
//
// `status: 'ready'` no resultado significa SOMENTE "a intenção está
// esclarecida o suficiente para seguir para planejamento/proposta" —
// NUNCA "execute agora". Confirmation Policy e autorização explícita do
// usuário continuam obrigatórias antes de qualquer execução real, em
// outro módulo, ainda não implementado.
export function advanceConversationState(
  state: ConversationState,
  updatedIntent: StructuredIntent,
  expiresAt: EpochMillis,
): ConversationAdvanceResult {
  const decision = evaluateClarification(updatedIntent);

  if (decision.status === 'ready') {
    return { status: 'ready', intent: updatedIntent };
  }

  // A ordem de qual campo perguntar em seguida já é decidida inteiramente
  // por getNextClarificationQuestion() (ordem canônica própria daquele
  // módulo) — este arquivo nunca guarda índice ou ordem paralela.
  const currentQuestion = getNextClarificationQuestion(decision);
  if (!currentQuestion) {
    // Mesma guarda defensiva estruturalmente inalcançável de
    // createConversationState().
    return { status: 'ready', intent: updatedIntent };
  }

  return {
    status: 'awaiting_clarification',
    state: {
      status: 'awaiting_clarification',
      pendingIntent: updatedIntent,
      currentQuestion,
      createdAt: state.createdAt, // preserva o início real da conversa
      expiresAt,
    },
  };
}

// Não recebe `state`: cancelar sempre produz o mesmo resultado,
// independentemente do estado atual — existe como operação nomeada só
// para deixar a intenção explícita em quem chama ("isto é um
// cancelamento", não um `= null` solto e sem contexto), não porque haja
// lógica real aqui. "Deixa pra lá" continua sem ser interpretado neste
// módulo — quem decidir que a frase significa cancelamento chama esta
// função depois de decidir isso, não o contrário.
export function cancelConversationState(): null {
  return null;
}

// Puro: `now` é sempre recebido explicitamente, nunca lido de Date.now()
// internamente — mesmo input, mesmo output, sem relógio global escondido.
//
// Segurança contra resposta tardia (não implementada aqui, só habilitada
// por este mecanismo): a futura camada de resolução de resposta deve
// checar isConversationStateExpired() ANTES de aplicar qualquer resposta
// a um pendingIntent — um estado expirado nunca deve ter sua pergunta
// respondida silenciosamente; o fluxo futuro deve tratar isso como uma
// conversa nova ou avisar que o contexto anterior expirou. Nenhuma dessas
// decisões de UX é tomada aqui.
export function isConversationStateExpired(state: ConversationState, now: EpochMillis): boolean {
  return now >= state.expiresAt;
}
