// Ajuste determinístico e MUITO estreito para frases de remarcação que têm
// dois horários explícitos, por exemplo:
//   "Mude a reunião de hoje às 15h para 16h."
//
// O guard temporal já existente em intent-extraction.ts compara o horário
// explícito do texto com `temporalWindow`. Para reschedule_event,
// `temporalWindow` representa o DESTINO; numa frase com origem + destino, o
// primeiro horário é a ORIGEM e faria o guard rejeitar uma NLU correta de
// destino. Em vez de enfraquecer o guard global, esta função prepara uma
// CÓPIA só para a NLU removendo o horário de origem quando todos os sinais
// abaixo são inequívocos. O texto original continua intacto e é usado pelo
// fluxo de remarcação para localizar o evento real.
//
// Nunca transforma frases sem verbo claro de remarcação, sem "para", sem
// dia original hoje/amanhã, ou sem dois horários válidos. Não interpreta
// qual evento é, não produz StructuredIntent e não executa I/O.
export type PreparedRescheduleNluInput = {
  text: string;
  transformed: boolean;
};

const RESCHEDULE_VERB_RE = /\b(mude|mudar|passe|passar|remarque|remarcar|altere|alterar)\b/i;
const CLOCK_RE = /(?:(?:às|\bas)\s+([01]?\d|2[0-3])(?:h[0-5]\d|:[0-5]\d|h)?\b(?![:\d])|\b([01]?\d|2[0-3])(?:h([0-5]\d)?|:([0-5]\d))\b)/gi;

export function prepareCalendarRescheduleNluInput(text: string): PreparedRescheduleNluInput {
  if (typeof text !== 'string' || text.trim().length === 0 || !RESCHEDULE_VERB_RE.test(text)) {
    return { text, transformed: false };
  }

  const lower = text.toLowerCase();
  const paraMatches = [...lower.matchAll(/\bpara\b/g)];
  const lastPara = paraMatches.at(-1);
  if (!lastPara || lastPara.index === undefined) {
    return { text, transformed: false };
  }

  const sourcePart = text.slice(0, lastPara.index);
  const destinationPart = text.slice(lastPara.index + lastPara[0].length);
  const normalizedSource = stripDiacritics(sourcePart.toLowerCase());

  const hasToday = /\bhoje\b/.test(normalizedSource);
  const hasTomorrow = /\bamanha\b/.test(normalizedSource) && !/\bdepois de amanha\b/.test(normalizedSource);
  if (hasToday === hasTomorrow) {
    return { text, transformed: false };
  }

  const sourceTimes = [...sourcePart.matchAll(CLOCK_RE)];
  CLOCK_RE.lastIndex = 0;
  const destinationTimes = [...destinationPart.matchAll(CLOCK_RE)];
  CLOCK_RE.lastIndex = 0;
  if (sourceTimes.length === 0 || destinationTimes.length === 0) {
    return { text, transformed: false };
  }

  const sourceTime = sourceTimes.at(-1);
  if (!sourceTime || sourceTime.index === undefined) {
    return { text, transformed: false };
  }

  const removeStart = sourceTime.index;
  const removeEnd = removeStart + sourceTime[0].length;
  const preparedSource = `${sourcePart.slice(0, removeStart).trimEnd()} ${sourcePart.slice(removeEnd).trimStart()}`;
  const prepared = `${preparedSource}${text.slice(lastPara.index)}`.replace(/\s{2,}/g, ' ').trim();

  return prepared === text
    ? { text, transformed: false }
    : { text: prepared, transformed: true };
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}
