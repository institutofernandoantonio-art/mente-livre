import assert from 'node:assert/strict';
import { applyCreateEventDefaults } from '../../src/lib/conversation/create-event-defaults.ts';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`[PASS] ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`[FAIL] ${name} — ${error.message}`);
  }
}

function createEvent(overrides = {}) {
  return {
    missingFields: [],
    confidence: 0.9,
    intentType: 'create_event',
    task: { kind: 'new_task', title: 'Reunião', description: null },
    temporalWindow: {
      expression: 'amanhã às 10h',
      resolved: { kind: 'relative_day', day: 'tomorrow', time: { hour: 10, minute: 0 } },
    },
    duration: null,
    participants: [],
    calendarAction: 'create',
    ...overrides,
  };
}

check('sem duração explícita recebe 60 minutos', () => {
  const result = applyCreateEventDefaults(createEvent({ missingFields: ['duration'] }));
  assert.equal(result.intentType, 'create_event');
  assert.deepEqual(result.duration, { source: 'inferred', value: { minutes: 60 }, confidence: 1 });
  assert.ok(!result.missingFields.includes('duration'));
});

check('duração unresolved não vira pergunta: usa 60 minutos', () => {
  const result = applyCreateEventDefaults(createEvent({
    duration: { source: 'unresolved', confidence: 0.4 },
  }));
  assert.equal(result.duration.value.minutes, 60);
});

check('duração apenas inferida pela IA não vence a regra de produto', () => {
  const result = applyCreateEventDefaults(createEvent({
    duration: { source: 'inferred', value: { minutes: 30 }, confidence: 0.8 },
  }));
  assert.equal(result.duration.value.minutes, 60);
});

check('duração explicitamente dita pelo usuário é preservada', () => {
  const stated = { source: 'stated', value: { minutes: 30 }, confidence: 0.99 };
  const result = applyCreateEventDefaults(createEvent({ duration: stated }));
  assert.deepEqual(result.duration, stated);
});

check('intervalo explícito de início/fim define sua própria duração', () => {
  const result = applyCreateEventDefaults(createEvent({
    temporalWindow: {
      expression: 'das 10h às 10h45',
      resolved: { kind: 'fixed', start: '2026-09-08T13:00:00.000Z', end: '2026-09-08T13:45:00.000Z' },
    },
  }));
  assert.equal(result.duration.value.minutes, 45);
});

check('outros tipos de intenção permanecem intocados', () => {
  const task = {
    missingFields: [], confidence: 0.9, intentType: 'create_task',
    task: { kind: 'new_task', title: 'Tarefa', description: null },
    temporalWindow: null, duration: null, deadline: null,
  };
  assert.equal(applyCreateEventDefaults(task), task);
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
