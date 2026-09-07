import assert from 'node:assert/strict';
import { normalizeConversationInput } from '../../src/lib/conversation/conversation-input-normalization.ts';

const cases = [
  ['sem aspas permanece igual', 'Criar tarefa: ligar para o contador hoje.', 'Criar tarefa: ligar para o contador hoje.'],
  ['aspas curvas externas são removidas', '“Criar tarefa: ligar para o contador hoje.”', 'Criar tarefa: ligar para o contador hoje.'],
  ['aspas retas externas são removidas', '"Criar tarefa: ligar para o contador hoje."', 'Criar tarefa: ligar para o contador hoje.'],
  ['aspas simples externas são removidas', "'Criar tarefa: ligar para o contador hoje.'", 'Criar tarefa: ligar para o contador hoje.'],
  ['espaço externo é removido junto', '  “Criar tarefa: ligar para o contador hoje.”  ', 'Criar tarefa: ligar para o contador hoje.'],
  ['aspas internas são preservadas', 'Criar tarefa: revisar “Lei do Ganhar” hoje.', 'Criar tarefa: revisar “Lei do Ganhar” hoje.'],
  ['pares não correspondentes não são removidos', '“Criar tarefa hoje."', '“Criar tarefa hoje."'],
  ['mensagem só com aspas vira vazia', '“”', ''],
];

for (const [name, input, expected] of cases) {
  assert.equal(normalizeConversationInput(input), expected, name);
  console.log(`[PASS] ${name}`);
}

console.log(`Todos os ${cases.length} casos de normalização passaram.`);
