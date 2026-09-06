// Normalização pura e conservadora para comparar a forma como o usuário
// se refere a um compromisso com o título real lido do Google Calendar.
//
// O matcher continua sem fuzzy/similarity: primeiro tenta a referência
// literalmente normalizada; só depois tenta uma variante estreita que
// remove wrappers linguísticos comuns (artigo/possessivo, verbo de
// remarcação/cancelamento e sufixo temporal "de hoje/amanhã às X").
//
// Isso cobre o caso real em que a NLU devolve, por exemplo,
// "a reunião teste de hoje às 18h" enquanto o título salvo no Google é
// apenas "Reunião teste". A variante limpa nunca escolhe entre múltiplos
// candidatos; essa proteção continua no resolver server-side.

const ACTION_PREFIX_RE = /^(?:mude|mudar|passe|passar|remarque|remarcar|altere|alterar|cancele|cancelar)\b\s*/i;
const LEADING_WRAPPER_RE = /^(?:(?:a|o|uma|um|minha|meu|minhas|meus)\s+)+/i;
const CLOCK_RE = '(?:[01]?\\d|2[0-3])(?:h(?:[0-5]\\d)?|:[0-5]\\d)';
const TEMPORAL_SUFFIX_RE = new RegExp(
  `\\s+(?:de\\s+)?(?:hoje|amanha)\\b(?:\\s+(?:as\\s+)?${CLOCK_RE})?.*$`,
  'i',
);

export function normalizeCalendarEventTitleForMatching(text: string): string {
  return normalizeBasic(text);
}

export function buildCalendarEventReferenceMatchingCandidates(raw: string): string[] {
  const literal = normalizeBasic(raw);
  if (literal === '') return [];

  const cleaned = normalizeReferenceFallback(literal);
  return [...new Set([literal, cleaned].filter((value) => value.length > 0))];
}

function normalizeReferenceFallback(value: string): string {
  let result = value;
  result = result.replace(ACTION_PREFIX_RE, '').trim();
  result = result.replace(LEADING_WRAPPER_RE, '').trim();
  result = result.replace(TEMPORAL_SUFFIX_RE, '').trim();
  result = result.replace(/[.,;:!?]+$/g, '').trim();
  result = result.replace(LEADING_WRAPPER_RE, '').trim();
  return result.replace(/\s+/g, ' ');
}

function normalizeBasic(text: string): string {
  if (typeof text !== 'string') return '';

  let value = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  value = stripSingleEnclosingQuotePair(value);
  return value.replace(/[.,;:!?]+$/g, '').trim();
}

function stripSingleEnclosingQuotePair(value: string): string {
  if (value.length < 2) return value;

  const pairs = new Map([
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
  ]);
  const close = pairs.get(value[0]);
  return close && value.at(-1) === close ? value.slice(1, -1).trim() : value;
}
