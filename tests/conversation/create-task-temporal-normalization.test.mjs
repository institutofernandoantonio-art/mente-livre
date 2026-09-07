import assert from 'node:assert/strict';
import { normalizeCreateTaskRelativeDay } from '../../src/lib/conversation/create-task-temporal-normalization.ts';
import { buildProposedAction } from '../../src/lib/conversation/proposed-action.ts';

const NOW = Date.parse('2026-09-07T15:00:00.000Z'); // 12:00 em America/Sao_Paulo

function taskIntent(relativeDay, time = null) {
  return {
    intentType: 'create_task',
    missingFields: [],
    confidence: 0.95,
    task: { kind: 'new_task', title: 'Ligar para o contador', description: null },
    temporalWindow: {
      expression: relativeDay === 'today' ? 'hoje' : 'amanhã',
      resolved: { kind: 'relative_day', day: relativeDay, time },
    },
    duration: null,
    deadline: null,
  };
}

const today = normalizeCreateTaskRelativeDay(taskIntent('today'), NOW, 'America/Sao_Paulo');
assert.equal(today.intentType, 'create_task');
assert.equal(today.temporalWindow, null);
assert.deepEqual(today.deadline, {
  source: 'inferred',
  value: { at: '2026-09-08T02:59:00.000Z' },
  confidence: 0.95,
});
assert.equal(buildProposedAction(today).status, 'proposed');
console.log('[PASS] hoje sem hora vira prazo no fim do dia e fica materializável');

const tomorrowAt1530 = normalizeCreateTaskRelativeDay(
  taskIntent('tomorrow', { hour: 15, minute: 30 }),
  NOW,
  'America/Sao_Paulo',
);
assert.equal(tomorrowAt1530.intentType, 'create_task');
assert.equal(tomorrowAt1530.temporalWindow, null);
assert.deepEqual(tomorrowAt1530.deadline, {
  source: 'stated',
  value: { at: '2026-09-08T18:30:00.000Z' },
  confidence: 0.95,
});
assert.equal(buildProposedAction(tomorrowAt1530).status, 'proposed');
console.log('[PASS] amanhã com hora preserva a hora declarada no fuso do usuário');

const invalidTimezoneInput = taskIntent('today');
const invalidTimezone = normalizeCreateTaskRelativeDay(invalidTimezoneInput, NOW, 'Nao/Existe');
assert.deepEqual(invalidTimezone, invalidTimezoneInput);
assert.equal(buildProposedAction(invalidTimezone).status, 'not_materializable');
console.log('[PASS] timezone inválido falha fechado e não apaga a janela temporal');

const nonRelative = {
  ...taskIntent('today'),
  temporalWindow: {
    expression: 'no próximo horário livre',
    resolved: { kind: 'next_free_slot', minDurationMinutes: null },
  },
};
const untouched = normalizeCreateTaskRelativeDay(nonRelative, NOW, 'America/Sao_Paulo');
assert.deepEqual(untouched, nonRelative);
console.log('[PASS] janelas de Planning continuam intocadas');
