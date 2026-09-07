import assert from 'node:assert/strict';
import { normalizeConversationInput } from '../../src/lib/conversation/conversation-input-normalization.ts';

const cases = [
  ['comando explícito permanece igual', 'Criar tarefa: ligar para o contador hoje.', 'Criar tarefa: ligar para o contador hoje.'],
  ['aspas curvas externas são removidas', '“Criar tarefa: ligar para o contador hoje.”', 'Criar tarefa: ligar para o contador hoje.'],
  ['aspas retas externas são removidas', '"Criar tarefa: ligar para o contador hoje."', 'Criar tarefa: ligar para o contador hoje.'],
  ['aspas simples externas são removidas', "'Criar tarefa: ligar para o contador hoje.'", 'Criar tarefa: ligar para o contador hoje.'],
  ['espaço externo é removido junto', '  “Criar tarefa: ligar para o contador hoje.”  ', 'Criar tarefa: ligar para o contador hoje.'],
  ['aspas internas são preservadas', 'Criar tarefa: revisar “Lei do Ganhar” hoje.', 'Criar tarefa: revisar “Lei do Ganhar” hoje.'],
  ['pares não correspondentes não são removidos', '“Criar tarefa hoje."', '“Criar tarefa hoje."'],
  ['mensagem só com aspas vira vazia', '“”', ''],
  ['ligar em linguagem natural vira tarefa explícita', 'ligar para o contador hoje.', 'Criar tarefa: ligar para o contador hoje.'],
  ['revisar em linguagem natural vira tarefa explícita', 'Revisar proposta amanhã', 'Criar tarefa: Revisar proposta amanhã'],
  ['responder em linguagem natural vira tarefa explícita', 'responder o Gregory', 'Criar tarefa: responder o Gregory'],
  ['pergunta não é promovida para tarefa', 'falar com o contador hoje?', 'falar com o contador hoje?'],
  ['comando de agenda não é promovido para tarefa', 'marcar reunião amanhã', 'marcar reunião amanhã'],
  ['texto declarativo permanece intacto', 'o contador ligou hoje', 'o contador ligou hoje'],
];

for (const [name, input, expected] of cases) {
  assert.equal(normalizeConversationInput(input), expected, name);
  console.log(`[PASS] ${name}`);
}

console.log(`Todos os ${cases.length} casos de normalização passaram.`);
