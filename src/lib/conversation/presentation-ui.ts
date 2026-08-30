import type { ProposedAction } from './proposed-action';
import type { ConversationPresentationState } from './presentation';
import type { ConversationEntryResult } from './conversation-entry';

// ============================================================================
// Presentation UI mapping — helper puro (zero I/O, zero `'use client'`/
// `'use server'`, zero dependência de React/Next/Supabase) que traduz os
// DTOs já aprovados de apresentação (`ConversationPresentationState`,
// `ConversationEntryResult`) para dados mínimos de UI: que mensagem
// adicionar ao transcript local, e se o input deve ser limpo.
//
// Todos os imports acima são `import type` — apagados em tempo de
// compilação, nunca uma dependência de runtime. Isso torna este módulo
// seguro para ser importado tanto por Server Components/Functions quanto
// por um Client Component (`ConversationPanel.tsx`) sem puxar
// `conversation-entry.ts`/`presentation.ts` (ambos `server-only`) para o
// bundle do browser.
//
// Este módulo NUNCA:
// - gera `id` — o `id` visual de cada mensagem (só para `key` do React) é
//   responsabilidade exclusiva do Client Component, nunca daqui, para
//   manter estas funções 100% determinísticas e testáveis com
//   `node:assert` (mesma entrada, mesma saída, sempre);
// - decide roteamento/status — só traduz um DTO já decidido por
//   `conversation-entry.ts`/`presentation.ts` para texto/estrutura de UI;
// - formata `deadline.at`/`duration.minutes` para lógica — as duas
//   funções de formatação abaixo são estritamente visuais; o valor
//   original nunca é alterado, nunca é usado para decidir nada.
// ============================================================================

// `id` deliberadamente ausente aqui — atribuído pelo Client Component ao
// inserir no histórico local, nunca por este módulo puro.
export type UiMessageContent =
  | { role: 'user'; kind: 'text'; text: string }
  | { role: 'assistant'; kind: 'text'; text: string }
  | { role: 'assistant'; kind: 'proposal'; action: ProposedAction };

// Textos fixos e genéricos — mesmo espírito de todo o resto do projeto
// (nunca expõe detalhe técnico/stack/erro cru ao usuário).
const EXPIRED_TEXT = 'O contexto anterior expirou. Envie sua mensagem novamente para começar de novo.';
const GENERIC_ERROR_TEXT = 'Algo deu errado. Tente novamente.';
const CONFIRMED_TEXT = 'Tarefa criada.';
const CANCELLED_TEXT = 'Proposta cancelada.';
const NEEDS_INPUT_TEXT = 'Não entendi. Pode responder de outro jeito?';
const UNSUPPORTED_TEXT = 'Por enquanto, consigo criar tarefas simples a partir do que você escreve.';
const CONFLICT_TEXT = 'O estado da conversa mudou. Revise o que está na tela e envie novamente.';

function assistantText(text: string): UiMessageContent {
  return { role: 'assistant', kind: 'text', text };
}

function assistantProposal(action: ProposedAction): UiMessageContent {
  return { role: 'assistant', kind: 'proposal', action };
}

// --- Bootstrap (montagem) → mensagem inicial opcional -----------------------
//
// `empty` nunca produz mensagem — não há nada a mostrar; o transcript local
// simplesmente começa vazio.

export function mapPresentationBootstrap(state: ConversationPresentationState): UiMessageContent | null {
  switch (state.status) {
    case 'empty':
      return null;
    case 'clarification_required':
      return assistantText(state.question);
    case 'proposal_ready':
      return assistantProposal(state.action);
    case 'expired':
      return assistantText(EXPIRED_TEXT);
    case 'error':
      return assistantText(GENERIC_ERROR_TEXT);
  }
}

// --- Envio → mensagem de resposta + se o input deve ser limpo --------------
//
// `clearInput`: `needs_input`/`conflict`/`error` preservam o texto (o
// usuário pode querer editar/reenviar); todos os outros limpam.

export type EntryResultUiEffect = {
  message: UiMessageContent;
  clearInput: boolean;
};

export function mapEntryResultToUiEffect(result: ConversationEntryResult): EntryResultUiEffect {
  switch (result.status) {
    case 'clarification_required':
      return { message: assistantText(result.question), clearInput: true };
    case 'proposal_ready':
      return { message: assistantProposal(result.action), clearInput: true };
    case 'confirmed':
      // `result.itemId` deliberadamente nunca lido aqui — a UI não expõe
      // nem depende dele (ver cabeçalho do Client Component).
      return { message: assistantText(CONFIRMED_TEXT), clearInput: true };
    case 'cancelled':
      return { message: assistantText(CANCELLED_TEXT), clearInput: true };
    case 'needs_input':
      return { message: assistantText(NEEDS_INPUT_TEXT), clearInput: false };
    case 'unsupported':
      return { message: assistantText(UNSUPPORTED_TEXT), clearInput: true };
    case 'conflict':
      return { message: assistantText(CONFLICT_TEXT), clearInput: false };
    case 'expired':
      return { message: assistantText(EXPIRED_TEXT), clearInput: true };
    case 'error':
      return { message: assistantText(GENERIC_ERROR_TEXT), clearInput: false };
  }
}

// --- Preview de proposta: formatação estritamente visual --------------------
//
// Nunca altera o valor original, nunca é reutilizado para lógica — só
// texto para o preview de `create_local_task`.

export function formatDeadlinePreview(deadline: { at: string } | null): string | null {
  if (deadline === null) {
    return null;
  }
  const parsed = new Date(deadline.at);
  if (Number.isNaN(parsed.getTime())) {
    // Fallback seguro: nunca esconde o dado por não conseguir formatá-lo.
    return deadline.at;
  }
  return parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatDurationPreview(duration: { minutes: number } | null): string | null {
  if (duration === null) {
    return null;
  }
  return `${duration.minutes} min`;
}
