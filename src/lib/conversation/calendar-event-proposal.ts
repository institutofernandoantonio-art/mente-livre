import type { StructuredIntent, TemporalWindow } from './types';
import type { ProposedAction } from './proposed-action';
import { isValidTimeZone, getCivilDateInTimeZone, addCivilDays, resolveCivilDateTimeInTimeZone } from './timezone';
import { MIN_DURATION_MINUTES, MAX_DURATION_MINUTES } from './answer-resolution';

// ============================================================================
// Calendar event proposal builder — Subfase 1 da criação de compromissos no
// Google Calendar: materializa um `StructuredIntent.create_event` JÁ
// suficientemente resolvido num `ProposedAction.create_calendar_event`.
//
// Módulo IRMÃO de `proposed-action.ts`, não uma extensão dele —
// `buildProposedAction` continua tratando SÓ `create_task`, sem nunca
// crescer para `create_event` (ver comentário correspondente naquele
// arquivo). Este arquivo existe porque `create_event` precisa de duas
// coisas que `create_task` nunca precisa: um relógio (`now`) e o timezone
// do request — mudar a assinatura de `buildProposedAction` só para
// acomodar isso exigiria tocar nos dois call sites reais dele em
// `conversation-turn.ts`, fora do escopo desta subfase (ver "Regra
// central" do enunciado: só a parte "IA recomenda", zero wiring).
//
// Este módulo NUNCA:
// - faz I/O — zero fetch, zero Supabase, zero Google Calendar, zero
//   `server-only`, zero Server Action;
// - lê o relógio/timezone do servidor — `now` e `timezone` são SEMPRE
//   argumentos explícitos do chamador, nunca `Date.now()`/timezone
//   implícito. Resolver "hoje"/"amanhã" com o timezone do SERVIDOR (em vez
//   do timezone real do usuário, já propagado por toda a pilha desde
//   `ConversationPanel.tsx`) produziria o dia civil ERRADO sempre que os
//   dois fusos divergirem — exatamente o bug que este desenho existe para
//   evitar;
// - persiste nada, chama `replaceRuntimeState`/`advanceRuntimeState`, ou
//   conhece `ConversationState`/`ProposalState`/`conversation-turn.ts`/
//   `proposal-turn.ts` — é chamado por uma camada futura, ainda não
//   conectada nesta subfase;
// - adiciona participantes, localização, recorrência, Google Meet, ou
//   qualquer campo além do shape mínimo já definido em `proposed-action.ts`;
// - adivinha data/hora: qualquer `TemporalWindow` que não seja um instante
//   já absoluto (`fixed`/`anchored_start`) ou `relative_day` COM hora
//   explícita vira `not_materializable`, nunca um palpite. Um horário
//   civil que não existe (lacuna de horário de verão) ou que é ambíguo
//   (sobreposição de horário de verão) também nunca é resolvido com um
//   palpite — ambos os casos viram `not_materializable` (ver
//   `resolveCivilDateTimeInTimeZone`, `./timezone.ts`, e a nota logo
//   abaixo sobre `relative_day`).
//
// --- `invalid` vs `not_materializable` ------------------------------------
//
// `invalid`: problema com os PRÓPRIOS argumentos do chamador (`now`/
// `timezone`), OU dois fatos já resolvidos do próprio intent que se
// contradizem entre si (ver `fixed` abaixo) — nunca uma questão de "o
// intent ainda não tem informação suficiente".
//
// `not_materializable`: os argumentos do chamador estão corretos e nada se
// contradiz, mas o CONTEÚDO do intent (janela temporal, duração) não é
// suficientemente rico para virar um instante concreto com segurança agora
// — mesma semântica já estabelecida em `proposed-action.ts`
// (`ProposedActionBuildResult`).
//
// --- `fixed`: `start`/`end` E `duration` precisam concordar ---------------
//
// `create_event.duration` é, por design da Clarification Policy
// (`clarification.ts`, `isDurationKnown`), exigido INCONDICIONALMENTE,
// mesmo quando a janela já é `fixed` (que também já carrega seu próprio
// `end`). Isso significa que uma janela `fixed` chega aqui com DOIS fatos
// independentes sobre o fim do evento: o `end` da própria janela, e o
// `start + duration`. Em vez de privilegiar um e descartar o outro em
// silêncio (decisão revertida nesta subfase — ver histórico no relatório
// de mapeamento), este builder trata a divergência entre os dois como uma
// INCONSISTÊNCIA real do próprio intent: calcula `expectedEnd = start +
// duration`, compara com o `end` da janela, e:
// - se coincidirem exatamente (mesmo epoch ms) → materializa, usando o
//   `end` da própria janela (já confirmado coerente com a duração);
// - se divergirem → `invalid` (nunca `not_materializable` — a informação
//   não está faltando, ela está CONTRADITÓRIA; escolher um dos dois
//   silenciosamente inventaria um fato que o usuário não confirmou).
//
// `anchored_start`/`relative_day` continuam sem essa tensão (a janela não
// carrega nenhum `end` próprio) — `end` é sempre `start + duration`, sem
// comparação nenhuma.
// ============================================================================

const FIXED_REMINDER_MINUTES_BEFORE_START = 30;

// Narrowing explícito do intent, nunca `as` — mesmo padrão já usado em
// `calendar-query.ts` (`QueryCalendarIntent`). O chamador (uma camada
// futura, ainda não conectada) já verifica `intentType === 'create_event'`
// antes de chamar esta função; este alias só nomeia o tipo resultante.
export type CreateEventIntent = Extract<StructuredIntent, { intentType: 'create_event' }>;

export type CreateCalendarEventBuildResult =
  | { status: 'built'; action: ProposedAction }
  | { status: 'not_materializable' }
  | { status: 'invalid' };

// --- Validação mínima de boundary (mesmo padrão do resto da pilha) --------

function isValidNow(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

// Mesmo racional/implementação já usada em runtime-state-validation.ts —
// confirma só que a string é parseável, nunca reinterpreta a data.
function isIsoParseableString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

// Mesmos limites já aprovados como política de domínio em
// answer-resolution.ts (5min–12h) — reaproveitados aqui em vez de uma
// segunda faixa divergente. Um `duration` construído por qualquer caminho
// (NLU direto, resposta de clarificação) passa pela mesma régua antes de
// virar um evento real.
function isValidDurationMinutes(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= MIN_DURATION_MINUTES && minutes <= MAX_DURATION_MINUTES;
}

// --- Resolução de start/end por kind ---------------------------------------
//
// Único ponto que decide QUAIS kinds de TemporalWindow são materializáveis
// nesta primeira versão (ver "Casos temporais permitidos" no relatório de
// mapeamento) — e, para `fixed`, também aplica a checagem de coerência
// contra `duration` descrita no cabeçalho do arquivo. `durationMinutes` já
// chega validado (ver buildCreateCalendarEventAction) — nunca revalidado
// aqui.
type ResolvedEventTimes =
  | { status: 'resolved'; start: Date; end: Date }
  | { status: 'not_materializable' }
  // Dois fatos já resolvidos do intent se contradizem — só possível para
  // `fixed` (ver cabeçalho do arquivo).
  | { status: 'incoherent' };

function resolveEventTimes(window: TemporalWindow, durationMinutes: number, nowDate: Date, timezone: string): ResolvedEventTimes {
  const resolved = window.resolved;

  switch (resolved.kind) {
    case 'fixed': {
      if (!isIsoParseableString(resolved.start) || !isIsoParseableString(resolved.end)) {
        return { status: 'not_materializable' };
      }
      const start = new Date(resolved.start);
      const givenEnd = new Date(resolved.end);
      const expectedEndMs = start.getTime() + durationMinutes * 60_000;

      if (givenEnd.getTime() !== expectedEndMs) {
        // start+duration e o end da própria janela discordam — nunca
        // escolhido silenciosamente (ver cabeçalho do arquivo).
        return { status: 'incoherent' };
      }

      // Defesa em profundidade: já garantido pela igualdade acima (
      // expectedEndMs é sempre > start.getTime(), porque durationMinutes
      // já foi validado como positivo antes de chegar aqui) — mas `end >
      // start` nunca é assumido silenciosamente sem checar de verdade.
      if (givenEnd.getTime() <= start.getTime()) {
        return { status: 'not_materializable' };
      }

      return { status: 'resolved', start, end: givenEnd };
    }

    case 'anchored_start': {
      if (!isIsoParseableString(resolved.start)) {
        return { status: 'not_materializable' };
      }
      const start = new Date(resolved.start);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      return { status: 'resolved', start, end };
    }

    case 'relative_day': {
      if (resolved.time === null) {
        // Sem hora explícita — deliberadamente não materializável nesta
        // versão (ver enunciado da subfase, item 3).
        return { status: 'not_materializable' };
      }

      // "Hoje" é sempre o dia civil do USUÁRIO (nunca UTC do servidor) —
      // getCivilDateInTimeZone lê isso direto de `nowDate`, sem
      // aritmética de offset (direção sempre segura, ver ./timezone.ts).
      // "Amanhã" avança um DIA CIVIL (addCivilDays), nunca 24h em ms —
      // continua correto em dias de 23h/25h por horário de verão.
      const today = getCivilDateInTimeZone(nowDate, timezone);
      const civilDay = resolved.day === 'today' ? today : addCivilDays(today, 1);

      const resolution = resolveCivilDateTimeInTimeZone(
        civilDay.year,
        civilDay.month,
        civilDay.day,
        resolved.time.hour,
        resolved.time.minute,
        timezone,
      );

      // `nonexistent` (horário civil não existe, ex.: 02:30 no dia de
      // spring-forward em America/New_York) e `ambiguous` (horário civil
      // existe duas vezes, ex.: 01:30 no dia de fall-back) recebem o
      // MESMO tratamento aqui: `not_materializable`, nunca `invalid`. A
      // razão: `invalid` neste módulo é reservado para dois fatos JÁ
      // RESOLVIDOS que se contradizem entre si (ver `fixed` acima) — aqui
      // não há contradição entre dois fatos independentes, há um único
      // horário civil pedido que este timezone, nesta data, não consegue
      // representar como um instante único e seguro. "Recusar a
      // materialização em vez de adivinhar" (regra desta subfase) mapeia
      // diretamente em `not_materializable`: a informação dada não é
      // suficiente para produzir um instante concreto com segurança.
      if (resolution.status !== 'resolved') {
        return { status: 'not_materializable' };
      }

      const start = resolution.utc;
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      return { status: 'resolved', start, end };
    }

    case 'next_free_slot':
    case 'relative_to_event':
    case 'unresolved':
      // Fora de escopo nesta primeira versão — nunca um palpite.
      return { status: 'not_materializable' };
  }
}

// --- API pública -----------------------------------------------------------
//
// Recebe SÓ o necessário: o intent já com intentType estreitado,
// `now` (epoch ms) e `timezone` (IANA) — nunca client Supabase, userId,
// ConversationState/ProposalState, ou qualquer coisa além destes três.
export function buildCreateCalendarEventAction(
  intent: CreateEventIntent,
  now: number,
  timezone: string,
): CreateCalendarEventBuildResult {
  if (!isValidNow(now)) {
    return { status: 'invalid' };
  }
  if (!isValidTimeZone(timezone)) {
    return { status: 'invalid' };
  }

  const nowDate = new Date(now);
  if (Number.isNaN(nowDate.getTime())) {
    // Estruturalmente inalcançável com um `now` já validado por
    // isValidNow acima — guarda defensiva, mesmo padrão já usado em
    // calendar-query.ts.
    return { status: 'invalid' };
  }

  const { duration } = intent;
  if (duration === null || duration.source === 'unresolved') {
    return { status: 'not_materializable' };
  }
  if (!isValidDurationMinutes(duration.value.minutes)) {
    return { status: 'not_materializable' };
  }

  const times = resolveEventTimes(intent.temporalWindow, duration.value.minutes, nowDate, timezone);

  if (times.status === 'not_materializable') {
    return { status: 'not_materializable' };
  }
  if (times.status === 'incoherent') {
    return { status: 'invalid' };
  }

  const { start, end } = times;

  // Defesa em profundidade: já garantido para todo kind resolvido acima
  // (fixed via a checagem de coerência; anchored_start/relative_day porque
  // `durationMinutes` já foi validado como positivo) — nunca assumido
  // silenciosamente sem checar de novo neste ponto final.
  if (end.getTime() <= start.getTime()) {
    return { status: 'not_materializable' };
  }

  return {
    status: 'built',
    action: {
      actionType: 'create_calendar_event',
      event: {
        title: intent.task.title,
        description: intent.task.description,
        start: start.toISOString(),
        end: end.toISOString(),
        timezone,
        reminderMinutesBeforeStart: FIXED_REMINDER_MINUTES_BEFORE_START,
      },
    },
  };
}
