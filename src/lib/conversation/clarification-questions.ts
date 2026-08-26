import type { MissingField } from './types';
import type { ClarificationDecision } from './clarification';

// ============================================================================
// Clarification Question layer — "como perguntar isso?"
//
// Não decide o que falta (isso é responsabilidade exclusiva de
// evaluateClarification(), em ./clarification.ts) — só traduz um
// MissingField já decidido em uma pergunta curta, neutra e determinística.
// Nunca recalcula missingFields, nunca lê o StructuredIntent, nunca
// consulta Calendar, nunca autoriza nem executa nada, nunca gera texto de
// confirmação ("Confirmar?"/"Posso criar?") — isso pertence à futura
// Confirmation Policy, uma etapa completamente diferente do pipeline.
//
// 100% determinístico, sem IA: perguntas de segurança precisam ser
// previsíveis (se falta "duration", o sistema sempre sabe que está
// perguntando duração). Nenhuma personalização com conteúdo do intent
// nesta primeira versão — a pergunta funciona só a partir do MissingField,
// de propósito, para não acoplar esta camada ao contrato de intenção e
// para nunca arriscar vazar conteúdo real (nome de pessoa, título de
// evento) numa pergunta que também pode ser falada em voz alta.
//
// Zero side effects, zero I/O, zero Date.now(), zero dependência de
// Next.js/Supabase/Anthropic/Google. Mesmo input, sempre mesmo output.
// ============================================================================

export type ClarificationQuestion = {
  field: MissingField;
  text: string;
};

// Mesma ordem canônica já usada em clarification.ts — duplicada aqui de
// propósito (só 7 strings; não vale criar um módulo compartilhado só por
// isso) para que esta camada tenha comportamento determinístico próprio,
// sem depender silenciosamente da ordem já vir correta de quem a chamou.
const MISSING_FIELD_ORDER: readonly MissingField[] = [
  'task_title',
  'event_reference',
  'temporal_window',
  'time',
  'duration',
  'participant',
  'reminder_time',
];

function sortByCanonicalOrder(fields: readonly MissingField[]): MissingField[] {
  const unique = Array.from(new Set(fields));
  return unique.sort((a, b) => MISSING_FIELD_ORDER.indexOf(a) - MISSING_FIELD_ORDER.indexOf(b));
}

function assertNever(value: never): never {
  throw new Error(`MissingField não tratado: ${JSON.stringify(value)}`);
}

// Pergunta genérica e segura por campo — nunca personalizada com conteúdo
// do StructuredIntent (ver cabeçalho do arquivo). Curta, sem jargão, sem
// pressupor resposta, sem depender de tela/botão — lê bem em voz alta.
function questionTextForField(field: MissingField): string {
  switch (field) {
    case 'task_title':
      return 'O que você quer adicionar?';
    case 'event_reference':
      return 'Qual tarefa ou compromisso você quer dizer?';
    case 'temporal_window':
      return 'Para quando você quer isso?';
    case 'time':
      return 'Que horário você prefere?';
    case 'duration':
      return 'Quanto tempo você quer reservar?';
    case 'participant':
      return 'Qual pessoa você quer incluir?';
    case 'reminder_time':
      return 'Quando você quer que eu te lembre?';
    default:
      return assertNever(field);
  }
}

export function buildClarificationQuestion(field: MissingField): ClarificationQuestion {
  return { field, text: questionTextForField(field) };
}

// Uma pergunta por vez é o padrão desta primeira versão — evita
// bombardear o usuário (ou um agente de voz) com várias perguntas na
// mesma frase. `field` na saída é o que permitirá, numa camada futura
// (ConversationState, ainda não implementada), saber que a próxima
// resposta do usuário deve preencher exatamente este campo.
export function getNextClarificationQuestion(
  decision: ClarificationDecision,
): ClarificationQuestion | null {
  if (decision.status === 'ready') {
    return null;
  }

  const [first] = sortByCanonicalOrder(decision.missingFields);
  return first ? buildClarificationQuestion(first) : null;
}

// Lista completa, na ordem canônica — só para depuração/testes ou uma
// futura UI de texto que prefira mostrar tudo de uma vez. O padrão do
// produto continua sendo getNextClarificationQuestion(), uma por vez.
export function buildClarificationQuestions(
  decision: ClarificationDecision,
): ClarificationQuestion[] {
  if (decision.status === 'ready') {
    return [];
  }

  return sortByCanonicalOrder(decision.missingFields).map(buildClarificationQuestion);
}
