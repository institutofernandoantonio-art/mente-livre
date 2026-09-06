// ============================================================================
// Structured Intent — contrato de dados puro (TypeScript, zero dependências)
//
// Representa SOMENTE "o que foi entendido" de um texto/voz do usuário —
// nunca "o que já foi autorizado ou executado". Nada neste arquivo executa
// ações, faz chamada externa, ou depende de Next.js/Supabase/Anthropic/
// Google. É consumido futuramente tanto por texto digitado quanto por voz
// transcrita — a origem do canal nunca aparece dentro do significado da
// intenção (ver InputChannel, modelado à parte).
//
// Clarification Policy (quando perguntar) e Confirmation Policy (quando
// exigir aprovação antes de executar) ficam FORA deste módulo — este
// arquivo só descreve o dado entendido, nunca a decisão sobre o que fazer
// com ele.
// ============================================================================

// --- Confiança e resolução -------------------------------------------------

// 0 (nenhuma confiança) a 1 (certeza). Sempre atribuído por quem produz o
// StructuredIntent — este tipo não calcula nada sozinho. TypeScript não
// garante a faixa 0..1 em compile-time (permanece "number" de propósito,
// sem branding/validação aqui); texto/voz/IA são entradas não confiáveis,
// então a faixa precisará ser validada em runtime na futura fronteira que
// transforma essa saída não confiável em StructuredIntent — não
// implementado nesta etapa.
export type Confidence = number;

export type ResolutionSource = 'stated' | 'inferred' | 'unresolved';

// Wrapper reutilizável só para campos que genuinamente podem ter as três
// origens (dito / inferido / ainda não resolvido) — não usado em campos
// sempre extraídos verbatim do texto (ex. título de tarefa), onde o
// wrapper não reduziria ambiguidade nenhuma.
//
// Discriminada por "source" de propósito: um objeto achatado
// ({value: T | null; source}) permitiria construir estados
// semanticamente incoerentes (ex. source:'unresolved' com um value
// preenchido, ou source:'stated' com value:null) sem nenhum erro de
// compilação. Com a união abaixo, 'stated'/'inferred' EXIGEM um value
// real (nunca null); 'unresolved' nem tem o campo value — não sobra
// nem a possibilidade de preenchê-lo por engano.
export type ResolvedValue<T> =
  | { source: 'stated'; value: T; confidence: Confidence }
  | { source: 'inferred'; value: T; confidence: Confidence }
  | { source: 'unresolved'; confidence: Confidence };

// --- Tempo -------------------------------------------------------------

export type Duration = ResolvedValue<{ minutes: number }>;

export type Deadline = ResolvedValue<{ at: string }>; // ISO 8601

// Pequena e evolutiva de propósito. "expression" preserva a frase original
// (para exibição/confirmação futura); "resolved" é o que uma camada de
// Calendar consumiria — compatível em espírito com o PlanningWindow já
// existente em src/lib/google/planning-context.ts (não alterado aqui).
export type TemporalWindow = {
  expression: string; // ex.: "amanhã de manhã", "antes da reunião"
  resolved:
    | { kind: 'fixed'; start: string; end: string } // início e fim conhecidos (ISO 8601)
    | { kind: 'anchored_start'; start: string } // início conhecido, duração/fim ainda não
    | {
        kind: 'relative_day';
        day: 'today' | 'tomorrow';
        // Hora civil já declarada para esse dia relativo, sem nenhuma data
        // anexada — "amanhã" continua sem ser convertido para um instante
        // absoluto (isso exigiria `now`+timezone, responsabilidade de uma
        // camada futura). `{hour,minute} | null` em vez de dois campos
        // opcionais separados: hour/minute só existem juntos ou não
        // existem, nunca um sem o outro.
        time: { hour: number; minute: number } | null;
      }
    | { kind: 'next_free_slot'; minDurationMinutes: number | null }
    | { kind: 'relative_to_event'; anchor: 'before' | 'after'; eventReference: EventReference }
    | { kind: 'unresolved' };
};

// --- Referências: tarefa nova vs algo que já existe -------------------------

// Tarefa/evento descrito agora pela primeira vez — título sempre "stated"
// (extraído verbatim do texto), por isso não usa ResolvedValue.
export type TaskRef = {
  kind: 'new_task';
  title: string;
  description: string | null;
};

// Referência a algo que já existe (tarefa/evento anterior) — nunca o
// objeto completo, só como o usuário se referiu a ele; resolução real
// (a que id isso corresponde) é responsabilidade de quem consome este
// tipo, nunca automática/silenciosa quando ambígua.
export type EventReference = {
  kind: 'existing_reference';
  raw: string; // ex.: "a reunião de amanhã", "disso"
  resolvedId: string | null;
};

// Uma intenção pode se referir a algo novo ou a algo já existente — nunca
// os dois ao mesmo tempo. Union discriminada por "kind", não um par de
// campos opcionais independentes.
export type IntentSubject = TaskRef | EventReference;

export type ParticipantRef = {
  raw: string; // ex.: "João"
  resolvedId: string | null; // nunca resolvido automaticamente se ambíguo
};

// --- Ação de calendário --------------------------------------------------

export type CalendarAction = 'create' | 'reschedule' | 'cancel';

// --- Campos faltantes, união fechada (nunca string livre) ------------------

export type MissingField =
  | 'task_title'
  | 'time'
  | 'duration'
  | 'participant'
  | 'event_reference'
  | 'temporal_window'
  | 'reminder_time';

// --- Canal de entrada, modelado separadamente -------------------------------

// Nunca faz parte do SIGNIFICADO da intenção — é só metadado de origem,
// existe para quem produz o StructuredIntent (ou para telemetria), nunca
// para quem o consome decidir o que fazer com base nele.
export type InputChannel = 'text' | 'voice';

// --- Structured Intent, discriminated union por intentType -----------------
//
// Cada variante carrega só os campos que fazem sentido para ela. Isso
// impede estruturalmente combinações inválidas: cancel_event nunca aceita
// calendarAction diferente de 'cancel' (o campo é o literal fixo, não o
// union CalendarAction inteiro); query_calendar nunca exige task;
// capture_thought nunca exige temporalWindow.

type BaseIntent = {
  missingFields: MissingField[];
  confidence: Confidence;
};

export type StructuredIntent =
  | (BaseIntent & {
      intentType: 'capture_thought';
      task: TaskRef | null;
    })
  | (BaseIntent & {
      intentType: 'create_task';
      task: TaskRef;
      temporalWindow: TemporalWindow | null;
      duration: Duration | null;
      deadline: Deadline | null;
    })
  | (BaseIntent & {
      intentType: 'create_event';
      task: TaskRef;
      temporalWindow: TemporalWindow;
      duration: Duration | null;
      participants: ParticipantRef[];
      calendarAction: 'create';
    })
  | (BaseIntent & {
      intentType: 'plan_task';
      subject: IntentSubject;
      temporalWindow: TemporalWindow;
    })
  | (BaseIntent & {
      intentType: 'query_calendar';
      temporalWindow: TemporalWindow;
    })
  | (BaseIntent & {
      intentType: 'suggest_time';
      subject: IntentSubject;
      temporalWindow: TemporalWindow;
      duration: Duration | null;
    })
  | (BaseIntent & {
      intentType: 'reschedule_event';
      eventReference: EventReference;
      temporalWindow: TemporalWindow;
      calendarAction: 'reschedule';
    })
  | (BaseIntent & {
      intentType: 'cancel_event';
      eventReference: EventReference;
      calendarAction: 'cancel';
    })
  | (BaseIntent & {
      intentType: 'set_reminder';
      subject: IntentSubject;
      reminderWindow: TemporalWindow;
    })
  | (BaseIntent & {
      intentType: 'request_followup';
      subject: EventReference;
    })
  | (BaseIntent & {
      intentType: 'conversational_question';
      question: string;
    });
