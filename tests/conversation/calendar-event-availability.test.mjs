// Testes unitários de src/lib/conversation/calendar-event-availability.ts.
//
// Execução: npm run test:calendar-event-availability
//
// Importa o MÓDULO REAL (nenhuma cópia/duplicação de lógica). A única
// peça substituída é `getGoogleCalendarBusyTimes`, importado estaticamente
// de `../google/calendar` — substituída por dublê via o hook de resolução
// em tests/support/ (chamar o Google real exigiria OAuth/token real).
//
// `--conditions=react-server` necessário porque
// calendar-event-availability.ts (e, transitivamente, o módulo real de
// `../google/calendar`, se não fosse redirecionado) tem `import
// 'server-only'` no topo.

import assert from 'node:assert/strict';
import { checkCalendarEventAvailability } from '../../src/lib/conversation/calendar-event-availability.ts';
import { handlers } from '../support/fake-google-calendar.mjs';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function check(name, fn) {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    record(name, false, err.message);
  }
}

const START = '2027-03-14T14:00:00.000Z';
const END = '2027-03-14T15:00:00.000Z';

await check('1. busy vazio -> available', async () => {
  handlers.getGoogleCalendarBusyTimes = async () => [];
  const result = await checkCalendarEventAvailability(START, END);
  assert.deepEqual(result, { status: 'available' });
});

await check('2. 1 busy block -> busy', async () => {
  handlers.getGoogleCalendarBusyTimes = async () => [{ start: START, end: END }];
  const result = await checkCalendarEventAvailability(START, END);
  assert.deepEqual(result, { status: 'busy' });
});

await check('3. vários busy blocks -> busy (contagem nunca exposta)', async () => {
  handlers.getGoogleCalendarBusyTimes = async () => [
    { start: START, end: END },
    { start: '2027-03-14T16:00:00.000Z', end: '2027-03-14T17:00:00.000Z' },
  ];
  const result = await checkCalendarEventAvailability(START, END);
  assert.deepEqual(result, { status: 'busy' });
  assert.deepEqual(Object.keys(result), ['status']);
});

await check('4. getGoogleCalendarBusyTimes retorna null -> unavailable', async () => {
  handlers.getGoogleCalendarBusyTimes = async () => null;
  const result = await checkCalendarEventAvailability(START, END);
  assert.deepEqual(result, { status: 'unavailable' });
});

await check('5. janela repassada EXATAMENTE (nunca arredondada/ampliada)', async () => {
  let captured = null;
  handlers.getGoogleCalendarBusyTimes = async (timeMin, timeMax) => {
    captured = { timeMin, timeMax };
    return [];
  };
  await checkCalendarEventAvailability(START, END);
  assert.deepEqual(captured, { timeMin: START, timeMax: END });
});

await check('6. Google chamado exatamente 1 vez por verificação', async () => {
  let calls = 0;
  handlers.getGoogleCalendarBusyTimes = async () => {
    calls++;
    return [];
  };
  await checkCalendarEventAvailability(START, END);
  assert.equal(calls, 1);
});

await check('7. resultado nunca carrega intervalos brutos/contagem — só {status}', async () => {
  handlers.getGoogleCalendarBusyTimes = async () => [{ start: START, end: END }];
  const result = await checkCalendarEventAvailability(START, END);
  assert.deepEqual(Object.keys(result), ['status']);
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
