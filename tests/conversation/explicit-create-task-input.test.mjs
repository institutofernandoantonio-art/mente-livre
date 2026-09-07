import assert from 'node:assert/strict';
import { parseExplicitCreateTaskInput } from '../../src/lib/conversation/explicit-create-task-input.ts';

const today = parseExplicitCreateTaskInput('Criar tarefa: ligar para o contador hoje.');
assert.ok(today, 'comando explícito com hoje deve ser reconhecido');
assert.equal(today.intentType, 'create_task');
assert.equal(today.task.title, 'ligar para o contador');
assert.deepEqual(today.temporalWindow, {
  expression: 'hoje',
  resolved: { kind: 'relative_day', day: 'today', time: null },
});

const tomorrow = parseExplicitCreateTaskInput('Crie uma tarefa: revisar proposta amanhã');
assert.ok(tomorrow, 'comando explícito com amanhã deve ser reconhecido');
assert.equal(tomorrow.task.title, 'revisar proposta');
assert.equal(tomorrow.temporalWindow?.resolved.kind, 'relative_day');
assert.equal(tomorrow.temporalWindow?.resolved.day, 'tomorrow');

const noDate = parseExplicitCreateTaskInput('Criar tarefa: responder o Gregory.');
assert.ok(noDate, 'comando explícito sem data deve ser reconhecido');
assert.equal(noDate.task.title, 'responder o Gregory');
assert.equal(noDate.temporalWindow, null);

assert.equal(parseExplicitCreateTaskInput('O que tenho para hoje?'), null);
assert.equal(parseExplicitCreateTaskInput('Agende reunião amanhã'), null);
assert.equal(parseExplicitCreateTaskInput('Criar tarefa:'), null);

console.log('[PASS] parser determinístico de criação de tarefa explícita');
