// Normalização mínima de entrada antes da NLU.
//
// Responsabilidades deliberadamente estreitas:
// 1. remover apenas UM par de aspas externas quando a mensagem inteira estiver
//    envolvida por elas;
// 2. transformar frases curtas e inequivocamente acionáveis em linguagem
//    natural (ex.: "ligar para o contador hoje") na forma explícita já
//    suportada pelo pipeline ("Criar tarefa: ...").
//
// A segunda regra é conservadora: só cobre um conjunto pequeno de verbos de
// ação comuns no contexto de produtividade, exige conteúdo depois do verbo e
// nunca atua em perguntas nem em verbos de agenda como agendar/marcar/cancelar.
// Assim, não tenta substituir a NLU por um parser geral.

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
];

const NATURAL_TASK_VERBS = new Set([
  'ligar',
  'telefonar',
  'responder',
  'revisar',
  'enviar',
  'mandar',
  'pagar',
  'comprar',
  'fazer',
  'preparar',
  'organizar',
  'verificar',
  'conferir',
  'falar',
  'retornar',
  'atualizar',
  'concluir',
  'entregar',
  'buscar',
  'solicitar',
  'cobrar',
]);

function stripOneOuterQuotePair(text: string): string {
  if (text.length < 2) return text;

  for (const [open, close] of QUOTE_PAIRS) {
    if (text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length).trim();
    }
  }

  return text;
}

function shouldPromoteNaturalTask(text: string): boolean {
  if (text.length === 0 || text.includes('?')) return false;

  const normalized = text.toLocaleLowerCase('pt-BR');
  if (/^(crie|criar)\s+(?:uma\s+)?tarefa\b/u.test(normalized)) return false;

  const [firstWord, ...rest] = normalized.split(/\s+/u);
  return NATURAL_TASK_VERBS.has(firstWord) && rest.join(' ').trim().length >= 2;
}

export function normalizeConversationInput(text: string): string {
  const trimmed = text.trim();
  const unquoted = stripOneOuterQuotePair(trimmed);

  if (shouldPromoteNaturalTask(unquoted)) {
    return `Criar tarefa: ${unquoted}`;
  }

  return unquoted;
}
