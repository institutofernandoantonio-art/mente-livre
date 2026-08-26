import type {
  StructuredIntent,
  MissingField,
  TemporalWindow,
  Duration,
  EventReference,
  IntentSubject,
} from './types';

// ============================================================================
// Clarification Policy — lógica pura e determinística
//
// Responde só a UMA pergunta: "o que ainda precisamos saber antes de seguir
// para a próxima etapa (Planning)?" Nunca decide prioridade, horário ideal,
// disponibilidade real, confirmação ou execução — essas responsabilidades
// ficam em módulos futuros e separados (Planning, Proposed Action,
// Confirmation Policy, Execution).
//
// `status: 'ready'` significa só "informação suficiente para montar uma
// proposta" — NUNCA "autorizado a executar". Confirmation Policy e
// autorização explícita do usuário continuam obrigatórias antes de
// qualquer WRITE no Calendar, mesmo para create_event/reschedule_event/
// cancel_event/set_reminder já "ready" aqui.
//
// Zero side effects, zero I/O, zero Date.now(), zero dependência de
// Next.js/Supabase/Anthropic/Google — mesmo input sempre produz mesmo
// output. Funciona identicamente para uma intenção originada de texto ou
// de voz transcrita: o canal de entrada nunca é um parâmetro desta função.
// ============================================================================

// `needs_clarification` com missingFields vazio seria tão incoerente
// quanto os estados já corrigidos em ResolvedValue<T> — por isso o array
// aqui é uma tupla não-vazia, não um MissingField[] solto.
export type ClarificationDecision =
  | { status: 'ready'; missingFields: [] }
  | { status: 'needs_clarification'; missingFields: [MissingField, ...MissingField[]] };

// Ordem canônica — nunca a ordem incidental de inserção num Set. Mantém
// a saída determinística e estável para testes/consumidores futuros.
const MISSING_FIELD_ORDER: readonly MissingField[] = [
  'task_title',
  'event_reference',
  'temporal_window',
  'time',
  'duration',
  'participant',
  'reminder_time',
];

function normalizeMissingFields(fields: MissingField[]): MissingField[] {
  const unique = Array.from(new Set(fields));
  return unique.sort((a, b) => MISSING_FIELD_ORDER.indexOf(a) - MISSING_FIELD_ORDER.indexOf(b));
}

// --- Helpers estruturais, sem interpretação de linguagem natural -----------

function isTemporalWindowUnresolved(window: TemporalWindow): boolean {
  return window.resolved.kind === 'unresolved';
}

// "Falta hora de relógio?" NÃO é o mesmo que "falta informação temporal
// suficiente?" — só o segundo importa para a Clarification Policy, e só
// há exatamente UM kind onde pedir 'time' faz sentido: "relative_day" sem
// hora ainda resolvida (sabemos o dia, falta só a hora).
//
// "fixed"/"anchored_start" já carregam um instante concreto — nada a
// pedir. "next_free_slot" ("quando eu tiver uma hora livre") e
// "relative_to_event" ("antes da reunião") são intenções que
// DELIBERADAMENTE não têm hora de relógio — a ausência de horário fixo é
// o próprio significado da intenção, não uma lacuna a preencher agora;
// horário concreto para esses dois só surge depois, via Planning/Calendar
// resolvendo o slot ou o evento-âncora, nunca perguntando "que horário
// você prefere?" ao usuário. "unresolved" nunca chega aqui: já é
// interceptado antes por isTemporalWindowUnresolved (pede
// 'temporal_window', não 'time').
function isTimeMissingFromWindow(window: TemporalWindow): boolean {
  return window.resolved.kind === 'relative_day' && window.resolved.time === null;
}

function isDurationKnown(duration: Duration | null): boolean {
  return duration !== null && duration.source !== 'unresolved';
}

function isEventReferenceResolved(ref: EventReference): boolean {
  return ref.resolvedId !== null;
}

// TaskRef (algo descrito agora) é sempre resolvido por definição —
// EventReference só é resolvido se já tiver um id correspondente.
function subjectMissingField(subject: IntentSubject): MissingField | null {
  if (subject.kind === 'new_task') {
    return null;
  }
  return isEventReferenceResolved(subject) ? null : 'event_reference';
}

function assertNever(value: never): never {
  throw new Error(`StructuredIntent.intentType não tratado: ${JSON.stringify(value)}`);
}

// --- Regras por intentType --------------------------------------------------
//
// Um switch explícito por intentType, não uma abstração de regras
// genérica — mais fácil de ler, revisar e alterar um caso de cada vez.

function collectMissingFields(intent: StructuredIntent): MissingField[] {
  switch (intent.intentType) {
    case 'capture_thought':
      // Captura é deliberadamente permissiva — nunca exige horário,
      // duração ou Calendar. task pode até ser null (pensamento ainda
      // sem estrutura nenhuma) e mesmo assim está pronto.
      return [];

    case 'create_task':
      // task é obrigatório pelo próprio tipo (nunca null nesta variante)
      // — título sempre existe estruturalmente, não há o que duplicar
      // validando de novo aqui. Ausência de temporalWindow/duration/
      // deadline limita planejamento futuro, mas não impede criar a
      // tarefa em si.
      return [];

    case 'plan_task': {
      const fields: MissingField[] = [];
      const subjectField = subjectMissingField(intent.subject);
      if (subjectField) {
        fields.push(subjectField);
      }
      // Planejar só precisa de ALGUMA janela para buscar dentro dela —
      // não precisa de horário específico (mesma leniência de
      // query_calendar), por isso o teste é o mais fraco (fully unresolved).
      if (isTemporalWindowUnresolved(intent.temporalWindow)) {
        fields.push('temporal_window');
      }
      return fields;
    }

    case 'create_event': {
      const fields: MissingField[] = [];
      const window = intent.temporalWindow;
      if (isTemporalWindowUnresolved(window)) {
        fields.push('temporal_window');
      } else if (isTimeMissingFromWindow(window)) {
        // Só pede 'time' quando sabemos o dia (relative_day) mas ainda
        // não a hora — next_free_slot/relative_to_event nunca chegam
        // aqui (ver isTimeMissingFromWindow).
        fields.push('time');
      }
      // Checado independentemente da janela: mesmo sabendo o dia mas não
      // a hora, já vale perguntar a duração junto, em vez de dois turnos
      // separados — resultado mais completo para o usuário/voz de uma vez.
      if (!isDurationKnown(intent.duration)) {
        fields.push('duration');
      }
      const hasUnresolvedParticipant = intent.participants.some((p) => p.resolvedId === null);
      if (hasUnresolvedParticipant) {
        fields.push('participant');
      }
      return fields;
    }

    case 'query_calendar':
      // Consultar disponibilidade não exige horário específico — um dia,
      // uma semana ou uma busca por vaga livre já bastam.
      return isTemporalWindowUnresolved(intent.temporalWindow) ? ['temporal_window'] : [];

    case 'suggest_time': {
      const fields: MissingField[] = [];
      const subjectField = subjectMissingField(intent.subject);
      if (subjectField) {
        fields.push(subjectField);
      }
      if (isTemporalWindowUnresolved(intent.temporalWindow)) {
        fields.push('temporal_window');
      }
      // Sugerir horário sem saber a duração não permite achar um slot que
      // realmente comporte a tarefa.
      if (!isDurationKnown(intent.duration)) {
        fields.push('duration');
      }
      return fields;
    }

    case 'reschedule_event': {
      const fields: MissingField[] = [];
      if (!isEventReferenceResolved(intent.eventReference)) {
        fields.push('event_reference');
      }
      const window = intent.temporalWindow;
      if (isTemporalWindowUnresolved(window)) {
        fields.push('temporal_window');
      } else if (isTimeMissingFromWindow(window)) {
        fields.push('time');
      }
      // O tipo desta variante não tem campo de duration — nada a checar.
      return fields;
    }

    case 'cancel_event':
      return isEventReferenceResolved(intent.eventReference) ? [] : ['event_reference'];

    case 'set_reminder': {
      const fields: MissingField[] = [];
      const subjectField = subjectMissingField(intent.subject);
      if (subjectField) {
        fields.push(subjectField);
      }
      if (isTemporalWindowUnresolved(intent.reminderWindow)) {
        fields.push('reminder_time');
      }
      return fields;
    }

    case 'request_followup':
      // O tipo real só tem "subject: EventReference" — nada mais a checar.
      return isEventReferenceResolved(intent.subject) ? [] : ['event_reference'];

    case 'conversational_question':
      // Entender o conteúdo da pergunta é responsabilidade da futura
      // Conversation Understanding, não desta policy.
      return [];

    default:
      return assertNever(intent);
  }
}

// Função principal — pura, síncrona, sem I/O. Mesmo input, mesmo output.
export function evaluateClarification(intent: StructuredIntent): ClarificationDecision {
  const missingFields = normalizeMissingFields(collectMissingFields(intent));

  if (missingFields.length === 0) {
    return { status: 'ready', missingFields: [] };
  }

  // Seguro: acabamos de confirmar length > 0 na checagem acima.
  return {
    status: 'needs_clarification',
    missingFields: missingFields as [MissingField, ...MissingField[]],
  };
}
