import type { StructuredIntent, MissingField, Duration, TemporalWindow } from './types';

// ============================================================================
// Answer Resolution — "essa resposta curta preenche o campo pendente?"
//
// Recebe uma resposta JÁ CLASSIFICADA como resposta ao campo pendente
// atual (ex.: currentQuestion.field vindo de ConversationState) — esta
// camada nunca decide sozinha que uma frase é resposta a uma pergunta.
// A futura Conversation Understanding decide ANTES se o usuário mudou de
// assunto; esta função nunca reinterpreta a intenção inteira, nunca move
// texto para outro campo além do que foi explicitamente pedido.
//
// Nesta versão, suporta SOMENTE field === 'duration' e field === 'time'.
// Qualquer outro MissingField retorna 'unsupported' — sem exceção
// lançada, sem tentativa de adivinhar.
//
// Alta precisão, não alto recall: preferimos perguntar de novo
// ('unrecognized') a produzir uma duração errada a partir de uma
// transcrição de voz ambígua ou incorreta.
//
// Zero side effects, zero I/O, zero Date.now(), zero dependência de
// Next.js/Supabase/Anthropic/Google. Mesmo input, sempre mesmo output.
// Não loga nem persiste a resposta recebida — só a usa em memória para
// produzir um novo StructuredIntent.
// ============================================================================

export type AnswerResolutionResult =
  | { status: 'resolved'; intent: StructuredIntent }
  | { status: 'ambiguous' }
  | { status: 'unrecognized' }
  | { status: 'unsupported' };

// `invalid` foi avaliado e descartado: tanto "não reconheci o texto"
// quanto "reconheci o texto mas o valor é absurdo (0 min, 999h)" levam à
// mesma ação de quem consome o resultado — perguntar de novo. Um status
// a mais não mudaria nenhum comportamento, só duplicaria o significado.
//
// `ambiguous` É distinto disso, e traz vantagem estrutural real: "às
// quatro" foi reconhecido semanticamente (é claramente uma tentativa de
// dizer um horário), mas tem duas leituras igualmente válidas (04:00 ou
// 16:00) — diferente de um texto que simplesmente não corresponde a nada
// ("qualquer hora aí"). Uma futura Clarification Policy pode reagir
// diferente a cada um: para `ambiguous`, a repergunta pode ser cirúrgica
// ("De manhã ou à tarde?"); para `unrecognized`, só resta repetir a
// pergunta original. Deliberadamente sem payload nesta versão (nenhuma
// informação parcial é carregada) — carregar a hora ambígua para permitir
// essa repergunta cirúrgica é uma melhoria futura, não implementada aqui.
// `ambiguous` nunca carrega um StructuredIntent: informação ambígua não
// é informação resolvida, e não deve parecer uma atualização válida.

// --- Parsing determinístico de duração (pt-BR) ------------------------------
//
// Regex pequenas + mapa explícito, de propósito — nenhum parser genérico
// de números por extenso, nenhuma tentativa de cobrir todo o português.
// Cobre só os formatos abaixo; qualquer outra coisa retorna null.

// Frases por extenso mais comuns em fala (STT) — mapa explícito, não um
// parser de números por extenso genérico. Cada entrada é um match exato
// da resposta inteira já normalizada, nunca um match parcial.
const WORD_PHRASE_MINUTES: Readonly<Record<string, number>> = {
  'meia hora': 30,
  'uma hora': 60,
  'duas horas': 120,
  'uma hora e meia': 90,
  // "trinta minutos" é só mais uma entrada literal deste mesmo mapa
  // explícito (não exige lógica nova) — incluída por ser tão comum em
  // voz quanto "uma hora"/"meia hora".
  'trinta minutos': 30,
};

// "30 minutos", "30 min", "30 mins", "30min"
const MINUTE_ONLY_RE = /^(\d+)\s*min(?:uto)?s?$/;

// "1 hora", "2 horas", "1h", "2h"
const HOUR_ONLY_RE = /^(\d+)\s*h(?:ora)?s?$/;

// "1h30", "1h 30" — forma compacta, sem a palavra "minutos"
const COMPACT_HOUR_MINUTE_RE = /^(\d+)h\s*(\d+)$/;

// "1 hora e 30 minutos"
const HOUR_AND_MINUTE_WORDS_RE = /^(\d+)\s*h(?:ora)?s?\s*e\s*(\d+)\s*min(?:uto)?s?$/;

// trim + lowercase + colapso de espaços — normalização suficiente aqui.
// Não normaliza acentos: nenhuma palavra usada neste parser ("hora",
// "minuto", "meia", "uma", "duas", "trinta") tem acento, então uma
// biblioteca ou tabela de normalização de acentos não agregaria nada e
// só adicionaria complexidade sem uso real.
function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Retorna minutos brutos (ainda sem checar limites de segurança) ou null
// se o texto não corresponder a nenhum formato suportado.
//
// NÃO tenta suportar: "um tempinho", "rapidinho", "a tarde toda", "até
// acabar", números por extenso arbitrários, ou faixas/ambiguidade
// ("1 ou 2 horas", "entre 30 e 60 minutos", "mais ou menos uma hora").
// Todos esses simplesmente não casam com nenhum padrão abaixo e caem no
// `return null` final — não há necessidade de exclusão explícita.
function parseDurationAnswer(answer: string): number | null {
  const normalized = normalizeAnswer(answer);
  if (normalized === '') {
    return null;
  }

  const phraseMinutes = WORD_PHRASE_MINUTES[normalized];
  if (phraseMinutes !== undefined) {
    return phraseMinutes;
  }

  const hourAndMinuteMatch = normalized.match(HOUR_AND_MINUTE_WORDS_RE);
  if (hourAndMinuteMatch) {
    return combineHourMinute(Number(hourAndMinuteMatch[1]), Number(hourAndMinuteMatch[2]));
  }

  const compactMatch = normalized.match(COMPACT_HOUR_MINUTE_RE);
  if (compactMatch) {
    return combineHourMinute(Number(compactMatch[1]), Number(compactMatch[2]));
  }

  const hourMatch = normalized.match(HOUR_ONLY_RE);
  if (hourMatch) {
    return Number(hourMatch[1]) * 60;
  }

  const minuteMatch = normalized.match(MINUTE_ONLY_RE);
  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }

  return null;
}

// Rejeita combinações como "1h99" (99 não é uma quantidade válida de
// minutos dentro de uma hora) — sinal de formato mal digitado/transcrito,
// não uma duração real de 159 minutos. Checagem estrutural do formato,
// não a política de limites totais (isso é validateDurationMinutes).
function combineHourMinute(hours: number, minutes: number): number | null {
  if (minutes >= 60) {
    return null;
  }
  return hours * 60 + minutes;
}

// --- Limites de segurança ----------------------------------------------
//
// Mecanismo (parseDurationAnswer) e política (validateDurationMinutes)
// ficam deliberadamente separados: o parser só entende texto, os limites
// abaixo são uma decisão de produto isolada, fácil de revisar sem tocar
// no parsing.
//
// MVP: 5 minutos a 12 horas (720 minutos). Cobre reunião, bloco de foco
// e tarefa longa; abaixo de 5 min não há o que reservar de fato; acima de
// 12h a clarificação de "duração" deixa de fazer sentido (isso já seria
// um evento de dia inteiro, um caso fora do escopo desta camada). Não é
// uma política final de produto — só o suficiente para rejeitar valores
// claramente absurdos ("0 minutos", "999 horas") nesta primeira versão.
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 720;

function validateDurationMinutes(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= MIN_DURATION_MINUTES &&
    minutes <= MAX_DURATION_MINUTES
  );
}

// --- Atualização imutável do StructuredIntent -------------------------------
//
// Só create_task, create_event e suggest_time têm campo `duration` no
// contrato atual (ver types.ts) — usa o contrato real, não uma suposição.
// O spread `{ ...intent, duration }` dentro de cada branch do switch
// mantém a variante exata já estreitada pelo TypeScript (nunca um cast
// `as StructuredIntent`): o compilador garante que o objeto resultante
// ainda pertence à mesma variante da união, com todos os outros campos
// preservados intactos e só `duration` substituído.
function withUpdatedDuration(intent: StructuredIntent, minutes: number): StructuredIntent | null {
  // "stated": o usuário acabou de declarar isso explicitamente nesta
  // resposta — nunca "inferred" (que seria para um valor deduzido de
  // contexto, não dito). confidence: 1 representa a confiança do PARSER
  // de que entendeu corretamente o texto explícito, não uma estimativa de
  // que essa duração é a "certa" ou uma boa escolha para a tarefa — essa
  // segunda pergunta não é responsabilidade desta camada.
  const duration: Duration = { source: 'stated', value: { minutes }, confidence: 1 };

  switch (intent.intentType) {
    case 'create_task':
      return { ...intent, duration };
    case 'create_event':
      return { ...intent, duration };
    case 'suggest_time':
      return { ...intent, duration };
    default:
      // Variante sem campo `duration` no contrato — nunca adiciona a
      // propriedade artificialmente; devolve null e quem chamou decide
      // (aqui, sempre vira status 'unsupported').
      return null;
  }
}

// --- Parsing determinístico de hora (pt-BR) ---------------------------------
//
// Representa só a HORA CIVIL declarada (hour/minute) — nunca um instante
// absoluto, nunca uma data. `now` e timezone não entram aqui: converter
// "amanhã às 16h" num instante real (UTC/ISO) exige saber o dia civil de
// "amanhã" num fuso concreto, responsabilidade de uma camada futura que
// já tem `now`+timezone disponíveis. Esta função nunca inventa esse dia.
//
// Alta precisão: qualquer ambiguidade de período (AM/PM) retorna
// `ambiguous`, nunca um palpite. "às 4" nunca vira 04:00 nem 16:00
// silenciosamente.

type TimeParseOutcome =
  | { status: 'resolved'; time: { hour: number; minute: number } }
  | { status: 'ambiguous' }
  | { status: 'unrecognized' };

// "16:30"
const TIME_COLON_RE = /^(\d{1,2}):(\d{2})$/;

// "16h30"
const TIME_H_MINUTE_RE = /^(\d{1,2})h(\d{2})$/;

// "16h"
const TIME_H_ONLY_RE = /^(\d{1,2})h$/;

// "4 da tarde", "4 da manhã", "quatro da tarde", "quatro da manhã" — só o
// vocabulário por extenso estritamente necessário a estes exemplos
// aprovados (não um parser geral de números por extenso: "cinco",
// "seis"... não são suportados aqui, de propósito).
const TIME_PERIOD_RE = /^(\d{1,2}|quatro)\s+da\s+(tarde|manh[ãa])$/;

// "às quatro", "as quatro" — reconhecido como TENTATIVA de dizer um
// horário, mas sem período explícito. Restrito a 1-12: fora dessa faixa
// não há ambiguidade de AM/PM possível, e essa forma "às N" para N>12 não
// faz parte de nenhum exemplo aprovado — cai em `unrecognized`, não em
// `ambiguous`.
const BARE_HOUR_PREFIX_RE = /^[àa]s\s+(1[0-2]|[1-9]|quatro)$/;

// "4 horas", "quatro horas" — mesma lógica do padrão acima.
const BARE_HOUR_SUFFIX_RE = /^(1[0-2]|[1-9]|quatro)\s*horas?$/;

function wordOrDigitToNumber(token: string): number {
  return token === 'quatro' ? 4 : Number(token);
}

function isValidHour(hour: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

function isValidMinute(minute: number): boolean {
  return Number.isInteger(minute) && minute >= 0 && minute <= 59;
}

function finalizeExplicitTime(hour: number, minute: number): TimeParseOutcome {
  if (!isValidHour(hour) || !isValidMinute(minute)) {
    return { status: 'unrecognized' };
  }
  return { status: 'resolved', time: { hour, minute } };
}

// hour12 vem de um formato de 12 horas com período explícito (tarde/
// manhã) — válido só de 1 a 11. 12 e 0 são deliberadamente rejeitados:
// "12 da tarde"/"12 da manhã" são o par ambíguo meio-dia/meia-noite, fora
// de escopo desta versão (não inventamos qual dos dois o usuário quis).
function finalizePeriodTime(hour12: number, period: 'tarde' | 'manha'): TimeParseOutcome {
  if (hour12 < 1 || hour12 > 11) {
    return { status: 'unrecognized' };
  }
  return {
    status: 'resolved',
    time: { hour: period === 'tarde' ? hour12 + 12 : hour12, minute: 0 },
  };
}

// Full-match sempre (regex com ^...$): "acho que 16h", "16h talvez", "16h
// ou 17h", "entre 16h e 17h", "mais ou menos 16h" não casam com nenhum
// padrão abaixo e caem no `unrecognized` final — nenhuma extração parcial
// de uma frase maior.
function parseTimeAnswer(answer: string): TimeParseOutcome {
  const normalized = normalizeAnswer(answer);
  if (normalized === '') {
    return { status: 'unrecognized' };
  }

  const colonMatch = normalized.match(TIME_COLON_RE);
  if (colonMatch) {
    return finalizeExplicitTime(Number(colonMatch[1]), Number(colonMatch[2]));
  }

  const hMinuteMatch = normalized.match(TIME_H_MINUTE_RE);
  if (hMinuteMatch) {
    return finalizeExplicitTime(Number(hMinuteMatch[1]), Number(hMinuteMatch[2]));
  }

  const hOnlyMatch = normalized.match(TIME_H_ONLY_RE);
  if (hOnlyMatch) {
    return finalizeExplicitTime(Number(hOnlyMatch[1]), 0);
  }

  const periodMatch = normalized.match(TIME_PERIOD_RE);
  if (periodMatch) {
    const hour12 = wordOrDigitToNumber(periodMatch[1]);
    const period = periodMatch[2] === 'tarde' ? 'tarde' : 'manha';
    return finalizePeriodTime(hour12, period);
  }

  if (BARE_HOUR_PREFIX_RE.test(normalized) || BARE_HOUR_SUFFIX_RE.test(normalized)) {
    return { status: 'ambiguous' };
  }

  return { status: 'unrecognized' };
}

// --- Atualização imutável de hora no StructuredIntent ------------------------
//
// Só create_event e reschedule_event podem ter `field === 'time'` como
// pendente (ver clarification.ts: 'time' só é sinalizado quando a janela
// é `relative_day` sem hora ainda resolvida — nunca para next_free_slot/
// relative_to_event, que são intenções deliberadamente sem hora de
// relógio, nem para fixed/anchored_start, que já a têm). create_task/
// plan_task/query_calendar/suggest_time/set_reminder nunca pedem 'time';
// adicionar a propriedade a elas seria inventar um campo fora do
// contrato real.
function withUpdatedTime(intent: StructuredIntent, hour: number, minute: number): StructuredIntent | null {
  switch (intent.intentType) {
    case 'create_event':
    case 'reschedule_event': {
      const updatedWindow = withUpdatedTimeInWindow(intent.temporalWindow, hour, minute);
      if (updatedWindow === null) {
        return null;
      }
      return { ...intent, temporalWindow: updatedWindow };
    }
    default:
      return null;
  }
}

// Só compõe quando a janela já é `relative_day` — o ÚNICO kind em que a
// Clarification Policy corrigida ainda sinaliza 'time' como pendente (ver
// clarification.ts, isTimeMissingFromWindow). Preserva `day`
// explicitamente: "amanhã" nunca é perdido nem vira uma data inventada.
//
// Os demais kinds nunca deveriam chegar aqui com 'time' pendente:
// `next_free_slot`/`relative_to_event` são intenções deliberadamente sem
// hora de relógio (a Clarification Policy não pede mais 'time' para
// elas); `fixed`/`anchored_start` já têm hora; `unresolved` pede
// 'temporal_window' primeiro. O `null` (→ unsupported) aqui é só uma
// guarda defensiva para uma entrada estruturalmente inalcançável pelo
// pipeline atual, nunca uma composição inventada para esses casos.
function withUpdatedTimeInWindow(
  window: TemporalWindow,
  hour: number,
  minute: number,
): TemporalWindow | null {
  if (window.resolved.kind !== 'relative_day') {
    return null;
  }
  return {
    ...window,
    resolved: { kind: 'relative_day', day: window.resolved.day, time: { hour, minute } },
  };
}

// --- API principal -----------------------------------------------------

// `field` e `answer` são recebidos explicitamente por quem chama (ex.:
// state.currentQuestion.field e o texto do turno atual) — esta função
// nunca descobre sozinha qual campo está pendente.
//
// `resolved` aqui significa só "a resposta virou um valor estruturado
// com segurança" — nunca autorização para criar/alterar algo no Calendar.
// Duration/time `stated` continuam exigindo Confirmation Policy e
// aprovação explícita do usuário antes de qualquer execução real, em
// outro módulo. Um `switch` por `field` mantém esta função como a ÚNICA
// porta pública (resposta não confiável → AnswerResolutionResult →
// StructuredIntent tipado) — os parsers de cada campo continuam privados,
// e crescer para um novo MissingField no futuro é só adicionar um novo
// `case` aqui, sem expor uma segunda API.
export function resolveClarificationAnswer(
  intent: StructuredIntent,
  field: MissingField,
  answer: string,
): AnswerResolutionResult {
  switch (field) {
    case 'duration':
      return resolveDurationAnswer(intent, answer);
    case 'time':
      return resolveTimeAnswer(intent, answer);
    default:
      return { status: 'unsupported' };
  }
}

function resolveDurationAnswer(intent: StructuredIntent, answer: string): AnswerResolutionResult {
  const minutes = parseDurationAnswer(answer);
  if (minutes === null || !validateDurationMinutes(minutes)) {
    return { status: 'unrecognized' };
  }

  const updatedIntent = withUpdatedDuration(intent, minutes);
  if (updatedIntent === null) {
    return { status: 'unsupported' };
  }

  return { status: 'resolved', intent: updatedIntent };
}

function resolveTimeAnswer(intent: StructuredIntent, answer: string): AnswerResolutionResult {
  const parsed = parseTimeAnswer(answer);
  if (parsed.status === 'ambiguous') {
    return { status: 'ambiguous' };
  }
  if (parsed.status === 'unrecognized') {
    return { status: 'unrecognized' };
  }

  const updatedIntent = withUpdatedTime(intent, parsed.time.hour, parsed.time.minute);
  if (updatedIntent === null) {
    return { status: 'unsupported' };
  }

  return { status: 'resolved', intent: updatedIntent };
}
