import type { StructuredIntent, MissingField, Duration } from './types';

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
// Nesta primeira versão, suporta SOMENTE field === 'duration'. Qualquer
// outro MissingField retorna 'unsupported' — sem exceção lançada, sem
// tentativa de adivinhar.
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
  | { status: 'unrecognized' }
  | { status: 'unsupported' };

// `invalid` foi avaliado e descartado: tanto "não reconheci o texto"
// quanto "reconheci o texto mas o valor é absurdo (0 min, 999h)" levam à
// mesma ação de quem consome o resultado — perguntar de novo. Um status
// a mais não mudaria nenhum comportamento, só duplicaria o significado.

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

// --- API principal -----------------------------------------------------

// `field` e `answer` são recebidos explicitamente por quem chama (ex.:
// state.currentQuestion.field e o texto do turno atual) — esta função
// nunca descobre sozinha qual campo está pendente.
//
// `resolved` aqui significa só "a resposta virou um valor estruturado
// com segurança" — nunca autorização para criar/alterar algo no Calendar.
// Duration `stated` continua exigindo Confirmation Policy e aprovação
// explícita do usuário antes de qualquer execução real, em outro módulo.
export function resolveClarificationAnswer(
  intent: StructuredIntent,
  field: MissingField,
  answer: string,
): AnswerResolutionResult {
  if (field !== 'duration') {
    return { status: 'unsupported' };
  }

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
