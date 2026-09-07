import type { StructuredIntent } from './types';

type CreateTaskIntent = Extract<StructuredIntent, { intentType: 'create_task' }>;

const EXPLICIT_CREATE_TASK_RE = /^(?:crie|criar)\s+(?:uma\s+)?tarefa\s*[:\-]?\s+(.+)$/iu;
const TRAILING_RELATIVE_DAY_RE = /\s+(hoje|amanh[ãa])\s*[.!?]?\s*$/iu;

/**
 * Interpretação determinística e deliberadamente estreita para comandos
 * explícitos de criação de tarefa.
 *
 * A normalização de entrada pode promover frases naturais inequívocas como
 * "ligar para o contador hoje" para "Criar tarefa: ligar para o contador hoje".
 * Neste ponto não há motivo para pedir a uma IA que redescubra que o usuário
 * quer criar uma tarefa: montamos o StructuredIntent diretamente e mantemos a
 * mesma política de proposta + confirmação antes de qualquer escrita.
 *
 * Por segurança, esta função só:
 * - aceita prefixo explícito "crie/criar tarefa";
 * - extrai "hoje"/"amanhã" apenas quando aparecem no final;
 * - não tenta interpretar horário, datas livres, recorrência ou agenda;
 * - retorna null quando não há título útil, deixando o pipeline normal decidir.
 */
export function parseExplicitCreateTaskInput(text: string): CreateTaskIntent | null {
  const match = text.trim().match(EXPLICIT_CREATE_TASK_RE);
  if (!match) return null;

  let body = match[1].trim();
  if (!body) return null;

  let temporalWindow: CreateTaskIntent['temporalWindow'] = null;
  const relativeDayMatch = body.match(TRAILING_RELATIVE_DAY_RE);
  if (relativeDayMatch) {
    const rawDay = relativeDayMatch[1];
    body = body.slice(0, relativeDayMatch.index).trim().replace(/[.!?]+$/u, '').trim();
    if (!body) return null;

    temporalWindow = {
      expression: rawDay,
      resolved: {
        kind: 'relative_day',
        day: rawDay.toLocaleLowerCase('pt-BR').startsWith('amanh') ? 'tomorrow' : 'today',
        time: null,
      },
    };
  } else {
    body = body.replace(/[.!?]+$/u, '').trim();
    if (!body) return null;
  }

  return {
    intentType: 'create_task',
    task: {
      kind: 'new_task',
      title: body,
      description: null,
    },
    temporalWindow,
    duration: null,
    deadline: null,
    missingFields: [],
    confidence: 1,
  };
}
