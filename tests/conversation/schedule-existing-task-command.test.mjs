import assert from 'node:assert/strict';
import { parseScheduleExistingTaskCommand } from '../../src/lib/conversation/schedule-existing-task-command.ts';

assert.deepEqual(
  parseScheduleExistingTaskCommand('Agende ligar para o contador às 15 horas.'),
  { referenceRaw: 'ligar para o contador', day: 'today', hour: 15, minute: 0 },
);

assert.deepEqual(
  parseScheduleExistingTaskCommand('Agende ligar para o contador amanhã às 7 horas.'),
  { referenceRaw: 'ligar para o contador', day: 'tomorrow', hour: 7, minute: 0 },
);

assert.deepEqual(
  parseScheduleExistingTaskCommand('Agende a tarefa ligar para o contador amanha as 08:30'),
  { referenceRaw: 'ligar para o contador', day: 'tomorrow', hour: 8, minute: 30 },
);

assert.equal(parseScheduleExistingTaskCommand('Agende isso amanhã às 9 horas'), null);
assert.equal(parseScheduleExistingTaskCommand('Agende ligar para o contador amanhã às 25 horas'), null);

console.log('[PASS] parser diferencia hoje e amanhã sem perder a referência da tarefa');
