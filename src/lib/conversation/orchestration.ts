import 'server-only';

import {
  advanceConversationState,
  isConversationStateExpired,
  type ConversationAdvanceResult,
  type ConversationState,
} from './state';
import { resolveClarificationAnswer } from './answer-resolution';
import { resolveEventReferenceFromLocalItems } from './reference-resolution';
import type { EventReference, MissingField, StructuredIntent, TemporalWindow } from './types';

// ============================================================================
// Orchestration — "dado um ConversationState válido e uma resposta curta do
// usuário, como resolvemos este turno e produzimos o próximo estado?"
//
// Primeira conexão real entre as peças já existentes e isoladas:
// ConversationState → (TTL) → roteamento por currentQuestion.field →
// Answer Resolution OU Reference Resolution → atualização imutável do
// StructuredIntent → advanceConversationState().
//
// Server-only porque Reference Resolution faz I/O (Supabase, sessão
// atual) — mas os helpers de localização/atualização de EventReference
// abaixo permanecem puros de propósito, só a função principal e o branch
// de `event_reference` são assíncronos.
//
// Este módulo NÃO: interpreta intenção nova, cria evento no Calendar,
// altera banco, confirma ação, executa ação, persiste ConversationState,
// chama Anthropic, faz fuzzy matching novo, decide prioridade/planning.
// Nenhuma dessas responsabilidades pertence à orquestração de um turno de
// clarificação.
// ============================================================================

// --- Resultado ---------------------------------------------------------
//
// União do que já existe em AnswerResolutionResult/LocalReferenceResolutionResult/
// ConversationAdvanceResult, sem duplicar conceitos: `resolved` nunca é um
// status final aqui — ele sempre vira `ready` ou `awaiting_clarification`
// via advanceConversationState(). `expired` é o único status genuinamente
// novo desta camada (nenhum módulo anterior tinha como representar isso).
//
// Todo status que NÃO avança o estado carrega o `state` ORIGINAL,
// inalterado — nunca um `state` novo com TTL renovado silenciosamente.
export type ClarificationTurnResult =
  | { status: 'awaiting_clarification'; state: ConversationState }
  | { status: 'ready'; intent: StructuredIntent } // pronto p/ planejamento — NUNCA "execute agora"
  | { status: 'unrecognized'; state: ConversationState }
  | { status: 'ambiguous'; state: ConversationState } // nunca carrega candidates (ver relatório)
  | { status: 'not_found'; state: ConversationState }
  | { status: 'error'; state: ConversationState } // falha técnica — nunca vira not_found
  | { status: 'unsupported'; state: ConversationState }
  | { status: 'expired' };

function toTurnResult(result: ConversationAdvanceResult): ClarificationTurnResult {
  if (result.status === 'ready') {
    return { status: 'ready', intent: result.intent };
  }
  return { status: 'awaiting_clarification', state: result.state };
}

// --- Localização da EventReference pendente (puro) --------------------------
//
// `MissingField === 'event_reference'` só diz que HÁ uma lacuna dessa
// categoria — nunca qual das duas formas possíveis (target/subject da
// própria ação, ou anchor dentro de relative_to_event) está pendente.
// Por isso o slot é sempre derivado inspecionando o `StructuredIntent`
// real, nunca inferido só a partir do MissingField.

type PendingReferenceLocation = { kind: 'target' } | { kind: 'anchor' };

function isEventReferenceUnresolved(ref: EventReference): boolean {
  return ref.resolvedId === null;
}

// Referência-ALVO: a própria coisa que a ação afeta (cancelar ESTA
// reunião, remarcar ESTA reunião). Só existe como EventReference nas
// variantes onde o alvo pode já existir — create_task/create_event nunca
// têm alvo existente (task é sempre TaskRef, algo novo).
function getTargetEventReference(intent: StructuredIntent): EventReference | null {
  switch (intent.intentType) {
    case 'reschedule_event':
      return intent.eventReference;
    case 'cancel_event':
      return intent.eventReference;
    case 'request_followup':
      return intent.subject;
    case 'plan_task':
    case 'suggest_time':
    case 'set_reminder':
      return intent.subject.kind === 'existing_reference' ? intent.subject : null;
    default:
      // capture_thought/create_task/create_event/query_calendar/
      // conversational_question: nenhuma tem um "alvo" que possa ser uma
      // EventReference.
      return null;
  }
}

// Janela temporal relevante de cada variante (temporalWindow ou, para
// set_reminder, reminderWindow) — mesmo tipo TemporalWindow em ambos os
// casos, só o nome do campo muda.
function getRelevantTemporalWindow(intent: StructuredIntent): TemporalWindow | null {
  switch (intent.intentType) {
    case 'create_task':
      return intent.temporalWindow; // já é TemporalWindow | null no contrato
    case 'create_event':
    case 'plan_task':
    case 'query_calendar':
    case 'suggest_time':
    case 'reschedule_event':
      return intent.temporalWindow;
    case 'set_reminder':
      return intent.reminderWindow;
    default:
      return null;
  }
}

// Referência-ÂNCORA: só existe dentro de TemporalWindow.resolved quando
// kind === 'relative_to_event' ("antes/depois da reunião X").
function getAnchorEventReference(intent: StructuredIntent): EventReference | null {
  const window = getRelevantTemporalWindow(intent);
  if (window === null || window.resolved.kind !== 'relative_to_event') {
    return null;
  }
  return window.resolved.eventReference;
}

// CONVENÇÃO DE PRODUTO PARA O MVP, não uma afirmação semântica: se as
// duas formas estiverem unresolved ao mesmo tempo (só possível em
// plan_task/suggest_time/reschedule_event/set_reminder — ver relatório de
// mapeamento), a referência-alvo vence e é resolvida primeiro. Isso não
// significa que o alvo "importa mais" — é só a prioridade determinística
// necessária para decidir, sem ambiguidade, o que uma resposta como
// "Reunião com João" deve preencher quando o contrato atual
// (MissingField = 'event_reference') não distingue as duas formas. Depois
// que o alvo for resolvido, evaluateClarification() volta a apontar
// 'event_reference' (agora só por causa do anchor) no próximo turno, e
// esta mesma função encontrará o anchor normalmente.
//
// `create_task` está incluído em getAnchorEventReference/
// getRelevantTemporalWindow por completude de tipo, mas é estruturalmente
// inalcançável por esta função: a Clarification Policy atual
// (clarification.ts) nunca produz nenhum MissingField para create_task —
// sempre retorna [] — logo currentQuestion.field nunca seria
// 'event_reference' vindo de um create_task pendente. Se isso ocorrer
// mesmo assim (violação de invariante em camada anterior), o caminho
// abaixo simplesmente não encontra nenhum slot e retorna null →
// 'unsupported', nunca inventa comportamento.
function findPendingEventReferenceSlot(intent: StructuredIntent): PendingReferenceLocation | null {
  const target = getTargetEventReference(intent);
  if (target !== null && isEventReferenceUnresolved(target)) {
    return { kind: 'target' };
  }

  const anchor = getAnchorEventReference(intent);
  if (anchor !== null && isEventReferenceUnresolved(anchor)) {
    return { kind: 'anchor' };
  }

  return null;
}

// --- Atualização imutável do slot (puro) --------------------------------
//
// Mesmo padrão já usado em answer-resolution.ts: nunca muta `intent`, só
// produz um StructuredIntent novo via spread, preservando a variante
// exata (sem `as StructuredIntent`). Se o slot não corresponder de fato à
// variante do intent (não deveria acontecer, já que `location` é sempre
// derivado do mesmo `intent` na mesma chamada), retorna null — guarda
// defensiva, nunca uma composição inventada.
function withUpdatedEventReference(
  intent: StructuredIntent,
  location: PendingReferenceLocation,
  updatedReference: EventReference,
): StructuredIntent | null {
  return location.kind === 'target'
    ? withUpdatedTargetEventReference(intent, updatedReference)
    : withUpdatedAnchorEventReference(intent, updatedReference);
}

function withUpdatedTargetEventReference(
  intent: StructuredIntent,
  updatedReference: EventReference,
): StructuredIntent | null {
  switch (intent.intentType) {
    case 'reschedule_event':
      return { ...intent, eventReference: updatedReference };
    case 'cancel_event':
      return { ...intent, eventReference: updatedReference };
    case 'request_followup':
      return { ...intent, subject: updatedReference };
    case 'plan_task':
    case 'suggest_time':
    case 'set_reminder':
      return intent.subject.kind === 'existing_reference'
        ? { ...intent, subject: updatedReference }
        : null;
    default:
      return null;
  }
}

function withUpdatedAnchorEventReference(
  intent: StructuredIntent,
  updatedReference: EventReference,
): StructuredIntent | null {
  switch (intent.intentType) {
    case 'create_task': {
      if (intent.temporalWindow === null) {
        return null;
      }
      const updatedWindow = withUpdatedWindowAnchor(intent.temporalWindow, updatedReference);
      return updatedWindow === null ? null : { ...intent, temporalWindow: updatedWindow };
    }
    case 'create_event':
    case 'plan_task':
    case 'query_calendar':
    case 'suggest_time':
    case 'reschedule_event': {
      const updatedWindow = withUpdatedWindowAnchor(intent.temporalWindow, updatedReference);
      return updatedWindow === null ? null : { ...intent, temporalWindow: updatedWindow };
    }
    case 'set_reminder': {
      const updatedWindow = withUpdatedWindowAnchor(intent.reminderWindow, updatedReference);
      return updatedWindow === null ? null : { ...intent, reminderWindow: updatedWindow };
    }
    default:
      return null;
  }
}

// Preserva `anchor` ('before'/'after') e qualquer outro campo de
// `resolved`/`expression` via spread — nunca substitui a janela inteira
// por uma versão simplificada.
function withUpdatedWindowAnchor(
  window: TemporalWindow,
  updatedReference: EventReference,
): TemporalWindow | null {
  if (window.resolved.kind !== 'relative_to_event') {
    return null;
  }
  return {
    ...window,
    resolved: { ...window.resolved, eventReference: updatedReference },
  };
}

// --- Branch: duration/time (Answer Resolution, puro) ------------------------

function handleAnswerResolutionTurn(
  state: ConversationState,
  field: 'duration' | 'time',
  answer: string,
  nextExpiresAt: number,
): ClarificationTurnResult {
  const resolution = resolveClarificationAnswer(state.pendingIntent, field, answer);

  switch (resolution.status) {
    case 'unrecognized':
      return { status: 'unrecognized', state };
    case 'ambiguous':
      // Ambiguidade de time ("às quatro") é um conceito diferente de
      // ambiguidade de Reference Resolution (múltiplos candidatos), mas
      // ambas significam "preciso de mais clarificação, nunca escolho
      // sozinho" — daí compartilharem o mesmo status externo aqui. Nada é
      // misturado internamente: só o texto do status é reaproveitado.
      return { status: 'ambiguous', state };
    case 'unsupported':
      return { status: 'unsupported', state };
    case 'resolved':
      return toTurnResult(advanceConversationState(state, resolution.intent, nextExpiresAt));
    default:
      return { status: 'unsupported', state };
  }
}

// --- Branch: event_reference (Reference Resolution, I/O) --------------------

async function handleEventReferenceTurn(
  state: ConversationState,
  answer: string,
  nextExpiresAt: number,
): Promise<ClarificationTurnResult> {
  const location = findPendingEventReferenceSlot(state.pendingIntent);
  if (location === null) {
    // currentQuestion.field === 'event_reference' mas nenhuma
    // EventReference unresolved foi encontrada no intent real — estado
    // estruturalmente impossível sob a Clarification Policy atual (ver
    // comentário de findPendingEventReferenceSlot). Nunca inventa
    // comportamento: unsupported, estado preservado.
    return { status: 'unsupported', state };
  }

  // Referência ORIGINAL do slot (antes de resolver) — preservada para
  // manter `raw`/`kind` no resultado final (ver bloco `resolved` abaixo).
  // Estruturalmente sempre não-null aqui: `location` acabou de ser
  // derivado do mesmo `pendingIntent`, então a referência correspondente
  // sempre existe — guarda defensiva, não um caminho real.
  const originalReference =
    location.kind === 'target'
      ? getTargetEventReference(state.pendingIntent)
      : getAnchorEventReference(state.pendingIntent);
  if (originalReference === null) {
    return { status: 'unsupported', state };
  }

  // Duas decisões diferentes, deliberadamente separadas: (1) qual texto
  // usar como QUERY de matching — sempre a resposta FRESCA deste turno
  // ("Reunião com João"), nunca ficando presa a um `raw` antigo herdado
  // do reconhecimento original; (2) qual texto persistir como `raw` do
  // EventReference resolvido — ver bloco `resolved`, onde é
  // deliberadamente o `raw` ORIGINAL preservado, não `answer`. Este
  // objeto aqui é só a query efêmera passada a
  // resolveEventReferenceFromLocalItems, nunca o valor final gravado no
  // intent. `resolvedId: null` sempre — é a única forma válida de pedir a
  // resolução (resolveEventReferenceFromLocalItems recusa qualquer
  // resolvedId pré-existente, por design).
  const referenceToResolve: EventReference = {
    kind: 'existing_reference',
    raw: answer,
    resolvedId: null,
  };

  const resolution = await resolveEventReferenceFromLocalItems(referenceToResolve);

  switch (resolution.status) {
    case 'ambiguous':
      // Nunca escolhe, nunca guarda candidates no state, nunca expõe ids
      // — ver ClarificationTurnResult.ambiguous, que não carrega payload.
      return { status: 'ambiguous', state };
    case 'not_found':
      return { status: 'not_found', state };
    case 'error':
      // Falha técnica (auth/query) — nunca convertida em not_found.
      return { status: 'error', state };
    case 'unsupported':
      return { status: 'unsupported', state };
    case 'resolved': {
      // `resolved` aqui significa SOMENTE: "um candidate local_item foi
      // encontrado deterministicamente." NÃO significa: confirmação do
      // usuário, autorização de WRITE, que o candidato ainda existirá
      // daqui a pouco, que ownership não precisa mais ser revalidado, que
      // Calendar está autorizado, ou que Confirmation Policy (módulo
      // ainda inexistente) foi satisfeita. `resolvedId` aqui identifica
      // só uma referência conversacional — antes de qualquer WRITE
      // futuro, revalidação server-side completa + Confirmation Policy
      // separada continuam obrigatórias.
      //
      // `resolveEventReferenceFromLocalItems` só opera sobre
      // `local_item` nesta versão (reference-matching.ts recusa qualquer
      // candidato de outra fonte) — logo um `resolvedId` produzido aqui é
      // necessariamente de `items`. Essa invariante deixa de ser
      // suficiente no dia em que uma segunda fonte real (Google Calendar)
      // for integrada: `EventReference` ainda não carrega `source`, então
      // nada aqui poderia distinguir as duas depois disso — dívida já
      // registrada, não resolvida nesta subfase.
      //
      // `raw`/`kind` preservados do ORIGINAL (spread de originalReference),
      // nunca substituídos por `answer`: o único consumidor real de `raw`
      // em todo o projeto (reference-matching.ts) o usa exclusivamente
      // como texto de matching, nunca como histórico/auditoria — mas o
      // próprio contrato (types.ts) descreve `raw` como "como o usuário
      // se referiu" à entidade, uma legenda estável definida no
      // reconhecimento original, separada da resolução em si
      // (`resolvedId`). Preservar evita que uma futura resposta de
      // desambiguação puramente posicional ("a das quatro") sobrescreva
      // uma descrição semanticamente melhor já registrada — só
      // `resolvedId` muda aqui.
      const resolvedReference: EventReference = {
        ...originalReference,
        resolvedId: resolution.candidate.id,
      };

      const updatedIntent = withUpdatedEventReference(state.pendingIntent, location, resolvedReference);
      if (updatedIntent === null) {
        return { status: 'unsupported', state };
      }

      return toTurnResult(advanceConversationState(state, updatedIntent, nextExpiresAt));
    }
    default:
      return { status: 'unsupported', state };
  }
}

// --- API principal -----------------------------------------------------
//
// Recebe só o necessário: o estado, a resposta, e a política de tempo
// explícita (`now`/`nextExpiresAt`) — nunca `Date.now()` interno, mesmo
// princípio já usado em todo o resto de conversation/. Nunca recebe
// userId, candidates, source ou claims: a sessão é sempre resolvida
// internamente por resolveEventReferenceFromLocalItems, nunca passada por
// aqui.
//
// A checagem de expiração é sempre o PRIMEIRO passo — antes de qualquer
// roteamento ou I/O. Isso evita usar contexto conversacional morto para
// consultar dados reais do usuário.
export async function resolveClarificationTurn(
  state: ConversationState,
  answer: string,
  now: number,
  nextExpiresAt: number,
): Promise<ClarificationTurnResult> {
  if (isConversationStateExpired(state, now)) {
    return { status: 'expired' };
  }

  const field: MissingField = state.currentQuestion.field;

  switch (field) {
    case 'duration':
    case 'time':
      return handleAnswerResolutionTurn(state, field, answer, nextExpiresAt);
    case 'event_reference':
      return handleEventReferenceTurn(state, answer, nextExpiresAt);
    default:
      // task_title/participant/temporal_window/reminder_time: nenhum
      // resolver implementado ainda nesta subfase — unsupported, nunca
      // uma tentativa de adivinhar.
      return { status: 'unsupported', state };
  }
}
