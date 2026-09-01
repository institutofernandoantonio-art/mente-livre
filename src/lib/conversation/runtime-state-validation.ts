import type {
  StructuredIntent,
  TaskRef,
  EventReference,
  IntentSubject,
  ParticipantRef,
  Duration,
  Deadline,
  TemporalWindow,
  Confidence,
  MissingField,
} from './types';
import type { ConversationState } from './state';
import type { ClarificationQuestion } from './clarification-questions';
import type { ProposedAction } from './proposed-action';
import type { ProposalState } from './proposal-state';
import { isValidTimeZone } from './timezone';

// ============================================================================
// Runtime state validation — a fronteira entre a linha JSONB não confiável
// de `public.conversation_runtime_states` e os domain types puros
// (ConversationState/ProposalState).
//
// O banco (ver migration 20260826130000_create_conversation_runtime_states.sql)
// só garante que `payload` é um objeto JSON — nada além disso. `pendingIntent`/
// `action` podem conter uma StructuredIntent/ProposedAction de uma versão
// antiga do contrato, dados corrompidos, ou qualquer JSON estruturalmente
// válido porém semanticamente incompatível. Por isso `row.payload as
// ConversationState` é proibido em qualquer código futuro — este módulo é a
// única barreira que transforma esse `unknown` em algo seguro de usar.
//
// Assume-se que o client já desserializou a coluna `jsonb` para um valor JS
// puro (objeto/array/string/number/boolean/null) antes de chegar aqui — como
// o Supabase JS/PostgREST já fazem por padrão — então este módulo nunca
// chama `JSON.parse`.
//
// 100% puro: sem I/O, sem Supabase, sem `server-only`, sem `Date.now()`,
// sem `crypto`, sem `console`. A única função de tempo usada é
// `Date.parse(...)` sobre uma string JÁ recebida como argumento — determinística
// para uma mesma string de entrada, nunca lê o relógio do sistema.
//
// Este módulo NUNCA:
// - decide se um state está expirado (isso é `now` vs `expiresAt`,
//   responsabilidade do futuro repository — uma row expirada ainda é
//   estruturalmente `valid` aqui);
// - verifica ownership (`user_id` nunca é recebido/comparado aqui — RLS +
//   repository cuidam disso);
// - recomputa `evaluateClarification`/`buildProposedAction`/
//   `isProposalStateExpired`/`isConversationStateExpired` — validar
//   PERSISTÊNCIA não é o mesmo que executar POLICY. `currentQuestion.field`
//   é validado como um `MissingField` estruturalmente correto, nunca
//   recomputado a partir de `pendingIntent` para confirmar que "ainda é a
//   pergunta certa" — essa é uma garantia semântica de produto, não uma
//   garantia de shape, e misturar as duas acopla este boundary a uma policy
//   que pode evoluir independentemente;
// - lança exception como fluxo normal — payload malformado é um resultado
//   esperado do mundo real (bug de escrita anterior, contrato evoluído,
//   linha corrompida), nunca um bug interno deste módulo;
// - corrige/normaliza/trunca/faz coerção de dado (`"123"` nunca vira `123`,
//   um payload com campo extra nunca é silenciosamente aceito removendo o
//   campo) — só aceita ou rejeita.
//
// DECISÃO DE STRICTNESS: todo objeto validado (row raiz, payload raiz, e
// cada objeto aninhado — TaskRef/EventReference/ResolvedValue/TemporalWindow
// etc.) exige EXATAMENTE o conjunto de chaves do contrato real, nunca mais
// nunca menos. Um campo extra em qualquer nível é tratado como sinal de
// contrato divergente/corrupção, não como algo a ignorar — mais barato de
// implementar (uma comparação de chaves) do que parece, e detecta drift de
// schema cedo.
//
// DECISÃO DE PRECISÃO TEMPORAL: `expires_at` (coluna `timestamptz`) chega
// como string ISO 8601 e é convertido para epoch ms via `Date.parse`, que é
// determinístico para uma mesma string. Essa conversão deve ser exatamente
// igual a `payload.expiresAt` — nenhuma tolerância é criada porque o futuro
// adapter de escrita sempre parte de um `number` inteiro de epoch ms para
// derivar as duas representações a partir do MESMO valor (nunca dois
// cálculos independentes); logo o Postgres nunca chega a receber precisão
// de microssegundo que um `Date.parse` de volta para ms pudesse perder.
// Qualquer divergência encontrada aqui é tratada como corrupção (`invalid`),
// nunca escolhida/corrigida silenciosamente.
// ============================================================================

// --- Wrapper de domínio seguro -----------------------------------------

// Identidade (`stateId`) e discriminação (`kind`) pertencem só a este
// wrapper de storage — nunca aos domain types puros ConversationState/
// ProposalState, que continuam sem saber que são persistidos. Sem
// `userId`/`updatedAt`/metadados de linha: esses pertencem ao repository/
// auth boundary, nunca ao domínio validado.
export type StoredRuntimeState =
  | { stateId: string; kind: 'clarification'; state: ConversationState }
  | { stateId: string; kind: 'proposal'; state: ProposalState };

// `invalid` deliberadamente sem `reason`/`path`/eco do payload — superfície
// mínima, nenhum detalhe de por que a validação falhou é exposto nesta
// primeira versão (privacidade + não incentivar consumidores a inspecionar
// dado não confiável em vez de simplesmente descartá-lo).
export type RuntimeStateValidationResult =
  | { status: 'valid'; value: StoredRuntimeState }
  | { status: 'invalid' };

function invalid(): RuntimeStateValidationResult {
  return { status: 'invalid' };
}

// --- Primitivas genéricas ------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Exige exatamente este conjunto de chaves — nem a mais, nem a menos. Ver
// "DECISÃO DE STRICTNESS" no cabeçalho do arquivo.
function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  const objKeys = Object.keys(obj);
  if (objKeys.length !== keys.length) {
    return false;
  }
  return keys.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// `Number.isInteger` já implica finitude (retorna false para NaN/Infinity)
// — usado só onde "epoch ms"/"hora"/"minuto" são semanticamente inteiros
// por definição, nunca como regra de negócio inventada (ver Duration.value
// .minutes abaixo, que deliberadamente NÃO exige inteiro).
function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

// `Confidence` documenta explicitamente a faixa 0..1 como uma validação de
// runtime ainda pendente (ver types.ts) — diferente de hour/minute, que não
// têm essa mesma nota explícita, por isso não têm faixa imposta aqui.
function isValidConfidence(value: unknown): value is Confidence {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

// Usado só para strings com contrato ISO 8601 explícito no comentário do
// tipo (Deadline.value.at, TemporalWindow start/end, ProposedAction
// deadline.at) — nunca reinterpreta a data, só confirma que é parseável.
function isIsoParseableString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

// --- MissingField ----------------------------------------------------------

const MISSING_FIELDS: readonly MissingField[] = [
  'task_title',
  'time',
  'duration',
  'participant',
  'event_reference',
  'temporal_window',
  'reminder_time',
];

function isMissingField(value: unknown): value is MissingField {
  return typeof value === 'string' && (MISSING_FIELDS as readonly string[]).includes(value);
}

function isMissingFieldArray(value: unknown): value is MissingField[] {
  return Array.isArray(value) && value.every(isMissingField);
}

// --- TaskRef / EventReference / IntentSubject / ParticipantRef -------------

function isValidTaskRef(value: unknown): value is TaskRef {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['kind', 'title', 'description'])) return false;
  if (value.kind !== 'new_task') return false;
  if (typeof value.title !== 'string') return false;
  return value.description === null || typeof value.description === 'string';
}

function isValidEventReference(value: unknown): value is EventReference {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['kind', 'raw', 'resolvedId'])) return false;
  if (value.kind !== 'existing_reference') return false;
  if (typeof value.raw !== 'string') return false;
  return value.resolvedId === null || typeof value.resolvedId === 'string';
}

function isValidIntentSubject(value: unknown): value is IntentSubject {
  return isValidTaskRef(value) || isValidEventReference(value);
}

function isValidParticipantRef(value: unknown): value is ParticipantRef {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['raw', 'resolvedId'])) return false;
  if (typeof value.raw !== 'string') return false;
  return value.resolvedId === null || typeof value.resolvedId === 'string';
}

function isValidParticipantRefArray(value: unknown): value is ParticipantRef[] {
  return Array.isArray(value) && value.every(isValidParticipantRef);
}

// --- ResolvedValue<T> (Duration / Deadline) --------------------------------
//
// Único helper genérico deste arquivo — espelha exatamente as 3 variantes
// reais de ResolvedValue<T> (types.ts), nunca um framework de validação
// genérico. `Duration`/`Deadline` só diferem no shape de `value`.

function isValidResolvedValueShape(
  value: unknown,
  isValidInnerValue: (inner: unknown) => boolean,
): boolean {
  if (!isPlainObject(value)) return false;

  if (value.source === 'unresolved') {
    return hasExactKeys(value, ['source', 'confidence']) && isValidConfidence(value.confidence);
  }

  if (value.source === 'stated' || value.source === 'inferred') {
    if (!hasExactKeys(value, ['source', 'value', 'confidence'])) return false;
    if (!isValidConfidence(value.confidence)) return false;
    return isValidInnerValue(value.value);
  }

  return false;
}

// `minutes` deliberadamente NÃO exige `Number.isInteger`: o contrato
// (types.ts) só declara `number`, e a faixa de negócio 5–720 já pertence a
// answer-resolution.ts (policy), não a este boundary estrutural.
function isValidDurationValue(value: unknown): value is { minutes: number } {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['minutes'])) return false;
  return isFiniteNumber(value.minutes);
}

function isValidDuration(value: unknown): value is Duration {
  return isValidResolvedValueShape(value, isValidDurationValue);
}

function isValidDeadlineValue(value: unknown): value is { at: string } {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['at'])) return false;
  return isIsoParseableString(value.at);
}

function isValidDeadline(value: unknown): value is Deadline {
  return isValidResolvedValueShape(value, isValidDeadlineValue);
}

// --- TemporalWindow ----------------------------------------------------

function isValidRelativeDayTime(value: unknown): boolean {
  if (value === null) return true;
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['hour', 'minute'])) return false;
  // Sem faixa 0-23/0-59 imposta: o tipo não documenta essa faixa como uma
  // validação runtime pendente (diferente de Confidence) — só a natureza
  // inteira de "hora"/"minuto" é uma exigência estrutural real.
  return isFiniteInteger(value.hour) && isFiniteInteger(value.minute);
}

function isValidTemporalWindowResolved(value: unknown): boolean {
  if (!isPlainObject(value)) return false;

  switch (value.kind) {
    case 'fixed':
      return (
        hasExactKeys(value, ['kind', 'start', 'end']) &&
        isIsoParseableString(value.start) &&
        isIsoParseableString(value.end)
      );

    case 'anchored_start':
      return hasExactKeys(value, ['kind', 'start']) && isIsoParseableString(value.start);

    case 'relative_day':
      return (
        hasExactKeys(value, ['kind', 'day', 'time']) &&
        (value.day === 'today' || value.day === 'tomorrow') &&
        isValidRelativeDayTime(value.time)
      );

    case 'next_free_slot':
      return (
        hasExactKeys(value, ['kind', 'minDurationMinutes']) &&
        (value.minDurationMinutes === null || isFiniteNumber(value.minDurationMinutes))
      );

    case 'relative_to_event':
      return (
        hasExactKeys(value, ['kind', 'anchor', 'eventReference']) &&
        (value.anchor === 'before' || value.anchor === 'after') &&
        isValidEventReference(value.eventReference)
      );

    case 'unresolved':
      return hasExactKeys(value, ['kind']);

    default:
      return false;
  }
}

function isValidTemporalWindow(value: unknown): value is TemporalWindow {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['expression', 'resolved'])) return false;
  if (typeof value.expression !== 'string') return false;
  return isValidTemporalWindowResolved(value.resolved);
}

// --- ClarificationQuestion ---------------------------------------------
//
// Só shape estrutural: `field` precisa ser um MissingField real, `text`
// qualquer string. Deliberadamente NÃO recomputa evaluateClarification nem
// compara com o template atual de clarification-questions.ts — o texto é
// dado derivado que pode evoluir independentemente, e confirmar que esta é
// "a pergunta certa para este pendingIntent" seria validação semântica de
// policy, não de shape persistido (ver cabeçalho do arquivo).

function isValidClarificationQuestion(value: unknown): value is ClarificationQuestion {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['field', 'text'])) return false;
  if (!isMissingField(value.field)) return false;
  return typeof value.text === 'string';
}

// --- StructuredIntent (11 variantes reais) ---------------------------------

function hasValidBaseIntentFields(value: Record<string, unknown>): boolean {
  return isMissingFieldArray(value.missingFields) && isValidConfidence(value.confidence);
}

// Exportada para reaproveitamento pela futura fronteira de NLU
// (intent-extraction.ts, ainda não implementada — ver relatório de
// mapeamento da subfase correspondente): a saída bruta de um extrator de
// linguagem natural é tão não confiável quanto um payload JSONB lido do
// banco, então o MESMO type guard estrutural serve para as duas
// fronteiras, sem duplicar uma segunda validação quase idêntica. Nenhuma
// lógica foi alterada — só a visibilidade do símbolo.
export function isValidStructuredIntent(value: unknown): value is StructuredIntent {
  if (!isPlainObject(value)) return false;
  if (!hasValidBaseIntentFields(value)) return false;

  switch (value.intentType) {
    case 'capture_thought':
      return (
        hasExactKeys(value, ['missingFields', 'confidence', 'intentType', 'task']) &&
        (value.task === null || isValidTaskRef(value.task))
      );

    case 'create_task':
      return (
        hasExactKeys(value, [
          'missingFields',
          'confidence',
          'intentType',
          'task',
          'temporalWindow',
          'duration',
          'deadline',
        ]) &&
        isValidTaskRef(value.task) &&
        (value.temporalWindow === null || isValidTemporalWindow(value.temporalWindow)) &&
        (value.duration === null || isValidDuration(value.duration)) &&
        (value.deadline === null || isValidDeadline(value.deadline))
      );

    case 'create_event':
      return (
        hasExactKeys(value, [
          'missingFields',
          'confidence',
          'intentType',
          'task',
          'temporalWindow',
          'duration',
          'participants',
          'calendarAction',
        ]) &&
        isValidTaskRef(value.task) &&
        isValidTemporalWindow(value.temporalWindow) &&
        (value.duration === null || isValidDuration(value.duration)) &&
        isValidParticipantRefArray(value.participants) &&
        value.calendarAction === 'create'
      );

    case 'plan_task':
      return (
        hasExactKeys(value, ['missingFields', 'confidence', 'intentType', 'subject', 'temporalWindow']) &&
        isValidIntentSubject(value.subject) &&
        isValidTemporalWindow(value.temporalWindow)
      );

    case 'query_calendar':
      return (
        hasExactKeys(value, ['missingFields', 'confidence', 'intentType', 'temporalWindow']) &&
        isValidTemporalWindow(value.temporalWindow)
      );

    case 'suggest_time':
      return (
        hasExactKeys(value, [
          'missingFields',
          'confidence',
          'intentType',
          'subject',
          'temporalWindow',
          'duration',
        ]) &&
        isValidIntentSubject(value.subject) &&
        isValidTemporalWindow(value.temporalWindow) &&
        (value.duration === null || isValidDuration(value.duration))
      );

    case 'reschedule_event':
      return (
        hasExactKeys(value, [
          'missingFields',
          'confidence',
          'intentType',
          'eventReference',
          'temporalWindow',
          'calendarAction',
        ]) &&
        isValidEventReference(value.eventReference) &&
        isValidTemporalWindow(value.temporalWindow) &&
        value.calendarAction === 'reschedule'
      );

    case 'cancel_event':
      return (
        hasExactKeys(value, ['missingFields', 'confidence', 'intentType', 'eventReference', 'calendarAction']) &&
        isValidEventReference(value.eventReference) &&
        value.calendarAction === 'cancel'
      );

    case 'set_reminder':
      return (
        hasExactKeys(value, ['missingFields', 'confidence', 'intentType', 'subject', 'reminderWindow']) &&
        isValidIntentSubject(value.subject) &&
        isValidTemporalWindow(value.reminderWindow)
      );

    case 'request_followup':
      return (
        hasExactKeys(value, ['missingFields', 'confidence', 'intentType', 'subject']) &&
        isValidEventReference(value.subject)
      );

    case 'conversational_question':
      return (
        hasExactKeys(value, ['missingFields', 'confidence', 'intentType', 'question']) &&
        typeof value.question === 'string'
      );

    default:
      return false;
  }
}

// --- ProposedAction (hoje, duas variantes) ---------------------------------

function isValidProposedDeadline(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['at', 'source'])) return false;
  return isIsoParseableString(value.at) && (value.source === 'stated' || value.source === 'inferred');
}

function isValidProposedDuration(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['minutes', 'source'])) return false;
  return isFiniteNumber(value.minutes) && (value.source === 'stated' || value.source === 'inferred');
}

function isValidProposedActionTask(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ['title', 'description', 'deadline', 'duration'])) return false;
  if (typeof value.title !== 'string') return false;
  if (value.description !== null && typeof value.description !== 'string') return false;
  if (value.deadline !== null && !isValidProposedDeadline(value.deadline)) return false;
  return value.duration === null || isValidProposedDuration(value.duration);
}

// `create_calendar_event` — mesmo shape produzido por
// `buildCreateCalendarEventAction` (calendar-event-proposal.ts, Subfase 1
// da criação de compromissos no Google Calendar). Nenhum código real
// ainda persiste isto (conversation-turn.ts/proposal-turn.ts intocados
// nesta subfase) — este validador existe para já estar correto quando essa
// integração acontecer, sem precisar revisitar este arquivo depois.
function isValidProposedCalendarEventEvent(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (
    !hasExactKeys(value, ['title', 'description', 'start', 'end', 'timezone', 'reminderMinutesBeforeStart'])
  ) {
    return false;
  }
  if (typeof value.title !== 'string') return false;
  if (value.description !== null && typeof value.description !== 'string') return false;
  if (!isIsoParseableString(value.start)) return false;
  if (!isIsoParseableString(value.end)) return false;
  // `end > start` sempre — nunca igual, nunca invertido. Comparação por
  // epoch ms (Date.parse), nunca comparação de string.
  if (Date.parse(value.end) <= Date.parse(value.start)) return false;
  if (!isValidTimeZone(value.timezone)) return false;
  // Literal fixo nesta V1 — não é uma faixa, é EXATAMENTE 30.
  return value.reminderMinutesBeforeStart === 30;
}

function isValidProposedAction(value: unknown): value is ProposedAction {
  if (!isPlainObject(value)) return false;

  if (value.actionType === 'create_local_task') {
    return hasExactKeys(value, ['actionType', 'task']) && isValidProposedActionTask(value.task);
  }

  if (value.actionType === 'create_calendar_event') {
    return hasExactKeys(value, ['actionType', 'event']) && isValidProposedCalendarEventEvent(value.event);
  }

  return false;
}

// --- Payload por state_kind ----------------------------------------------
//
// `status` exige o literal exato — é isso que estruturalmente garante a
// coerência kind/status exigida (clarification ⇒ awaiting_clarification,
// proposal ⇒ awaiting_confirmation): como o chamador só invoca cada
// validador quando já sabe o `state_kind` correspondente, um `status`
// divergente já reprova aqui, sem precisar de uma checagem cruzada separada.

function isValidConversationStatePayload(value: Record<string, unknown>): value is ConversationState {
  if (!hasExactKeys(value, ['status', 'pendingIntent', 'currentQuestion', 'createdAt', 'expiresAt'])) {
    return false;
  }
  if (value.status !== 'awaiting_clarification') return false;
  if (!isValidStructuredIntent(value.pendingIntent)) return false;
  if (!isValidClarificationQuestion(value.currentQuestion)) return false;
  if (!isFiniteInteger(value.createdAt)) return false;
  return isFiniteInteger(value.expiresAt);
}

function isValidProposalStatePayload(value: Record<string, unknown>): value is ProposalState {
  if (!hasExactKeys(value, ['status', 'proposalId', 'action', 'createdAt', 'expiresAt'])) {
    return false;
  }
  if (value.status !== 'awaiting_confirmation') return false;
  if (!isNonEmptyString(value.proposalId)) return false;
  if (!isValidProposedAction(value.action)) return false;
  if (!isFiniteInteger(value.createdAt)) return false;
  return isFiniteInteger(value.expiresAt);
}

// --- API pública -----------------------------------------------------------
//
// Recebe `unknown`, nunca um tipo já "confiável" — o boundary real (uma
// linha vinda de `conversation_runtime_states`) entrega exatamente os
// quatro campos abaixo; `user_id`/`updated_at` nunca são exigidos aqui
// (pertencem ao repository/auth boundary, nunca à validação de domínio).
// Row raiz é estrita: um quinto campo (ex.: `user_id` vazado por um futuro
// `select('*')`) já reprova — o repository deve sempre selecionar somente
// `state_id,state_kind,payload,expires_at`.
export function validateStoredRuntimeState(input: unknown): RuntimeStateValidationResult {
  if (!isPlainObject(input)) return invalid();
  if (!hasExactKeys(input, ['state_id', 'state_kind', 'payload', 'expires_at'])) return invalid();

  const { state_id, state_kind, payload, expires_at } = input;

  if (!isNonEmptyString(state_id)) return invalid();
  if (state_kind !== 'clarification' && state_kind !== 'proposal') return invalid();
  if (typeof expires_at !== 'string') return invalid();

  const expiresAtMs = Date.parse(expires_at);
  if (Number.isNaN(expiresAtMs)) return invalid();
  if (!isPlainObject(payload)) return invalid();

  if (state_kind === 'clarification') {
    if (!isValidConversationStatePayload(payload)) return invalid();
    if (payload.expiresAt !== expiresAtMs) return invalid();
    return { status: 'valid', value: { stateId: state_id, kind: 'clarification', state: payload } };
  }

  if (!isValidProposalStatePayload(payload)) return invalid();
  if (payload.expiresAt !== expiresAtMs) return invalid();
  return { status: 'valid', value: { stateId: state_id, kind: 'proposal', state: payload } };
}
