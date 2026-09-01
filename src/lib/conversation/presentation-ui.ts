import type { ProposedAction } from './proposed-action';
import type { ConversationPresentationState } from './presentation';
import type { ConversationEntryResult } from './conversation-entry';
import type { CalendarQueryResult } from './calendar-query';

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
// Textos de `calendar_information` — ver calendarInformationText() abaixo.
// Frases factuais sobre compromissos/ocupações, nunca "você está livre o
// dia inteiro" (poderia sugerir algo além do que o Calendar consultado
// realmente garante — ver mapeamento desta subfase).
const CALENDAR_DAY_BUSY_TEXT = 'Você tem compromissos nesse dia.';
const CALENDAR_DAY_AVAILABLE_TEXT = 'Não encontrei horários ocupados nesse dia.';
const CALENDAR_HOUR_BUSY_TEXT = 'Esse horário está ocupado na sua agenda.';
const CALENDAR_HOUR_AVAILABLE_TEXT = 'Não encontrei compromisso nesse horário.';
const CALENDAR_UNSUPPORTED_TEXT = 'Por enquanto, só consigo checar sua agenda para hoje ou amanhã.';
const CALENDAR_ERROR_TEXT = 'Não consegui consultar seu Google Calendar agora.';
// Subfase 2 da criação de compromissos no Google Calendar — mensagens
// mínimas, só para o switch exaustivo compilar; a UI completa da proposta
// de create_calendar_event (preview visual) fica para subfase própria.
const SCHEDULE_CONFLICT_TEXT = 'Você já tem um compromisso nesse horário.';
const CALENDAR_UNAVAILABLE_TEXT = 'Não consegui confirmar sua disponibilidade agora. Tente novamente.';
// Subfase 5 da criação de compromissos no Google Calendar — nunca afirma
// que o evento já foi criado (a execução pode estar apenas CLAIMED, ainda
// não confirmada pelo Google): "começou a ser processado" é verdadeiro em
// ambos os casos (claimed ou já completed), sem prometer mais do que o
// sistema sabe neste momento.
const CALENDAR_PROCESSING_TEXT =
  'Esse compromisso já começou a ser processado e não pode mais ser cancelado por aqui.';

function assistantText(text: string): UiMessageContent {
  return { role: 'assistant', kind: 'text', text };
}

function assistantProposal(action: ProposedAction): UiMessageContent {
  return { role: 'assistant', kind: 'proposal', action };
}

// --- calendar_information → texto curto e determinístico --------------------
//
// Zero segunda chamada a LLM: a frase é escolhida por `status`/`scope`,
// nunca gerada a partir de conteúdo variável. Nunca menciona
// `busyBlockCount` (não melhora a UX pedida nesta fatia) nem inventa nome
// de compromisso (freebusy nunca devolve isso — ver calendar-query.ts).
function calendarInformationText(result: CalendarQueryResult): string {
  switch (result.status) {
    case 'busy':
      return result.scope === 'day' ? CALENDAR_DAY_BUSY_TEXT : CALENDAR_HOUR_BUSY_TEXT;
    case 'available':
      return result.scope === 'day' ? CALENDAR_DAY_AVAILABLE_TEXT : CALENDAR_HOUR_AVAILABLE_TEXT;
    case 'unsupported_window':
      return CALENDAR_UNSUPPORTED_TEXT;
    case 'error':
      // Calendar não conectado e falha técnica continuam indistinguíveis
      // aqui, de propósito — mesma decisão de calendar-query.ts. Nunca
      // afirma "não está conectado" sem evidência.
      return CALENDAR_ERROR_TEXT;
  }
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
// usuário pode querer editar/reenviar); `calendar_unavailable` também
// preserva — é deliberadamente TRANSITÓRIO na clarificação (Subfase 2 da
// criação de compromissos no Google Calendar: a clarification row
// original nunca é consumida/avançada, exatamente para permitir reenviar
// a MESMA resposta quando o Calendar voltar) — manter o texto já digitado
// pronto para reenvio é a extensão natural dessa mesma decisão. Todos os
// outros limpam.

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
    case 'calendar_information':
      return { message: assistantText(calendarInformationText(result.result)), clearInput: true };
    case 'schedule_conflict':
      return { message: assistantText(SCHEDULE_CONFLICT_TEXT), clearInput: true };
    case 'calendar_unavailable':
      // clearInput: false — deliberado (ver comentário acima): a mesma
      // resposta digitada pode ser reenviada assim que o Calendar voltar.
      return { message: assistantText(CALENDAR_UNAVAILABLE_TEXT), clearInput: false };
    case 'confirmed':
      // `result.itemId` deliberadamente nunca lido aqui — a UI não expõe
      // nem depende dele (ver cabeçalho do Client Component).
      return { message: assistantText(CONFIRMED_TEXT), clearInput: true };
    case 'cancelled':
      return { message: assistantText(CANCELLED_TEXT), clearInput: true };
    case 'calendar_processing':
      // clearInput: true — deliberado, diferente de `calendar_unavailable`
      // (que preserva o texto porque reenviar a MESMA resposta pode
      // funcionar assim que o Calendar voltar). Aqui reenviar "não"
      // verbatim produziria sempre o mesmo resultado (a execução já
      // começou, permanentemente) — não há nada de produtivo a repetir com
      // o texto já digitado, mesmo racional de `cancelled`/
      // `schedule_conflict` (resultado determinístico e terminal para esta
      // proposta).
      return { message: assistantText(CALENDAR_PROCESSING_TEXT), clearInput: true };
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
