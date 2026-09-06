import assert from 'node:assert/strict';
import { resolveCalendarQuery } from '../../src/lib/conversation/calendar-query.ts';
import { handlers } from '../support/fake-upcoming-events.mjs';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`[PASS] ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`[FAIL] ${name} — ${error.message}`);
  }
}

function query(day = 'today', time = null) {
  return {
    missingFields: [],
    confidence: 0.95,
    intentType: 'query_calendar',
    temporalWindow: {
      expression: day === 'today' ? 'hoje' : 'amanhã',
      resolved: { kind: 'relative_day', day, time },
    },
  };
}

const NOW = Date.parse('2026-09-06T17:00:00.000Z');

await check('timezone inválida falha fechado sem chamar Google', async () => {
  handlers.getGoogleCalendarEventsInWindow = async () => {
    throw new Error('não deveria chamar');
  };
  assert.deepEqual(await resolveCalendarQuery(query(), NOW, 'invalida'), { status: 'unsupported_window' });
});

await check('hoje em São Paulo usa a janela civil correta', async () => {
  let captured;
  handlers.getGoogleCalendarEventsInWindow = async (...args) => {
    captured = args;
    return { status: 'ok', events: [] };
  };
  const result = await resolveCalendarQuery(query(), NOW, 'America/Sao_Paulo');
  assert.deepEqual(captured, [
    '2026-09-06T03:00:00.000Z',
    '2026-09-07T03:00:00.000Z',
    'America/Sao_Paulo',
    8,
  ]);
  assert.deepEqual(result, { status: 'available', scope: 'day' });
});

await check('amanhã usa a janela do dia seguinte', async () => {
  let captured;
  handlers.getGoogleCalendarEventsInWindow = async (...args) => {
    captured = args;
    return { status: 'ok', events: [] };
  };
  await resolveCalendarQuery(query('tomorrow'), NOW, 'America/Sao_Paulo');
  assert.equal(captured[0], '2026-09-07T03:00:00.000Z');
  assert.equal(captured[1], '2026-09-08T03:00:00.000Z');
});

await check('hora específica consulta janela exata de uma hora', async () => {
  let captured;
  handlers.getGoogleCalendarEventsInWindow = async (...args) => {
    captured = args;
    return { status: 'ok', events: [] };
  };
  const result = await resolveCalendarQuery(query('today', { hour: 15, minute: 0 }), NOW, 'America/Sao_Paulo');
  assert.equal(captured[0], '2026-09-06T18:00:00.000Z');
  assert.equal(captured[1], '2026-09-06T19:00:00.000Z');
  assert.deepEqual(result, { status: 'available', scope: 'hour' });
});

await check('retorna título e horário dos compromissos sem metadados extras', async () => {
  handlers.getGoogleCalendarEventsInWindow = async () => ({
    status: 'ok',
    events: [
      {
        title: 'Reunião com Gabriel',
        start: '2026-09-06T18:00:00.000Z',
        end: '2026-09-06T19:00:00.000Z',
        allDay: false,
        htmlLink: 'https://calendar.google.com/event?eid=x',
      },
    ],
  });
  assert.deepEqual(await resolveCalendarQuery(query(), NOW, 'America/Sao_Paulo'), {
    status: 'events',
    scope: 'day',
    timeZone: 'America/Sao_Paulo',
    events: [
      {
        title: 'Reunião com Gabriel',
        start: '2026-09-06T18:00:00.000Z',
        end: '2026-09-06T19:00:00.000Z',
        allDay: false,
      },
    ],
  });
});

await check('erro ou permissão insuficiente nunca vira agenda vazia', async () => {
  for (const status of ['error', 'permissions', 'unavailable']) {
    handlers.getGoogleCalendarEventsInWindow = async () => ({ status, events: [] });
    assert.deepEqual(await resolveCalendarQuery(query(), NOW, 'America/Sao_Paulo'), { status: 'error' });
  }
});

await check('janela fora de today/tomorrow continua sem acesso ao Google', async () => {
  handlers.getGoogleCalendarEventsInWindow = async () => {
    throw new Error('não deveria chamar');
  };
  const intent = {
    missingFields: [],
    confidence: 0.9,
    intentType: 'query_calendar',
    temporalWindow: {
      expression: 'semana que vem',
      resolved: { kind: 'next_free_slot', minDurationMinutes: 30 },
    },
  };
  assert.deepEqual(await resolveCalendarQuery(intent, NOW, 'America/Sao_Paulo'), { status: 'unsupported_window' });
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
