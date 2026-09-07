// Normalização mínima de entrada antes da NLU.
// Remove apenas UM par de aspas externas quando a mensagem inteira estiver
// envolvida por elas. O conteúdo interno não é reescrito nem reinterpretado.
// Isso cobre textos copiados de instruções/teleprompter como:
// “Criar tarefa: ligar para o contador hoje.”

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
];

export function normalizeConversationInput(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 2) return trimmed;

  for (const [open, close] of QUOTE_PAIRS) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length).trim();
    }
  }

  return trimmed;
}
