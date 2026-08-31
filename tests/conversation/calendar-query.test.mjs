// Testes unitários de src/lib/conversation/calendar-query.ts.
//
// Execução: npm run test:calendar-query
//
// Importa o MÓDULO REAL (nenhuma cópia/duplicação de lógica). A única peça
// substituída é `getGoogleCalendarBusyTimes`, importado estaticamente de
// `../google/calendar` — substituída por dublê via o hook de resolução em
// tests/support/ (chamar o Google real exigiria OAuth/token real).
//
// `--conditions=react-server` necessário porque calendar-query.ts (e,
// transitivamente, o módulo real de `../google/calendar`, se não fosse
// redirecionado) tem `import 'server-only'` no topo.

import assert from 'node:assert/strict';
import { resolveCalendarQuery } from '../../src/lib/conversation/calendar-query.ts';
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

function neverCalled(name) {
  return async (...args) => {
    throw new Error(`${name} não deveria ter sido chamado, foi chamado com ${JSON.stringify(args)}`);
  };
}

// Reconfigura o dublê antes de cada teste — nunca deixa handler de um
// teste anterior vazar para o próximo. Default "neverCalled": qualquer
// teste que não configure explicitamente está, por construção, provando
// "zero chamada ao Google" para aquele cenário.
function setHandler(fn) {
  handlers.getGoogleCalendarBusyTimes = fn ?? neverCalled('getGoogleCalendarBusyTimes');
}

function queryCalendarIntent(temporalWindow) {
  return {
    missingFields: [],
    confidence: 0.9,
    intentType: 'query_calendar',
    temporalWindow,
  };
}

function relativeDayWindow(day, time = null) {
  return { expression: 'amanhã', resolved: { kind: 'relative_day', day, time } };
}

// ============================================================================
// 1-4. TIMEZONE INVÁLIDA — zero chamada ao Google, resultado seguro
// ============================================================================

const INVALID_TIMEZONES = [
  { label: 'string vazia', value: '' },
  { label: 'só espaços', value: '   ' },
  { label: 'não é IANA', value: 'Not/ATimeZone' },
  { label: 'não é string (number)', value: 123 },
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
];

for (const { label, value } of INVALID_TIMEZONES) {
  await check(`1. timezone inválida (${label}) -> unsupported_window, zero chamada ao Google`, async () => {
    setHandler();
    const result = await resolveCalendarQuery(
      queryCalendarIntent(relativeDayWindow('today')),
      1_700_000_000_000,
      value,
    );
    assert.deepEqual(result, { status: 'unsupported_window' });
  });
}

// ============================================================================
// 5-8. JANELAS NÃO SUPORTADAS (fora de relative_day) — zero chamada ao Google
// ============================================================================

const UNSUPPORTED_WINDOWS = [
  { label: 'fixed', resolved: { kind: 'fixed', start: '2024-06-10T10:00:00.000Z', end: '2024-06-10T11:00:00.000Z' } },
  { label: 'anchored_start', resolved: { kind: 'anchored_start', start: '2024-06-10T10:00:00.000Z' } },
  { label: 'next_free_slot', resolved: { kind: 'next_free_slot', minDurationMinutes: 30 } },
  {
    label: 'relative_to_event',
    resolved: {
      kind: 'relative_to_event',
      anchor: 'before',
      eventReference: { kind: 'existing_reference', raw: 'a reunião', resolvedId: 'item-1' },
    },
  },
  { label: 'unresolved', resolved: { kind: 'unresolved' } },
];

for (const { label, resolved } of UNSUPPORTED_WINDOWS) {
  await check(`2. temporalWindow.resolved.kind '${label}' -> unsupported_window, zero chamada ao Google`, async () => {
    setHandler();
    const intent = queryCalendarIntent({ expression: 'x', resolved });
    const result = await resolveCalendarQuery(intent, 1_700_000_000_000, 'America/Sao_Paulo');
    assert.deepEqual(result, { status: 'unsupported_window' });
  });
}

// ============================================================================
// 9-10. RESOLUÇÃO today/tomorrow, timezone sem DST (America/Sao_Paulo, UTC-3)
// ============================================================================

// `now`: 2024-01-15T18:00:00.000Z == 2024-01-15T15:00:00 em São Paulo.
const NOW_JAN = Date.parse('2024-01-15T18:00:00.000Z');

await check('3. relative_day today, dia inteiro, América/São_Paulo -> janela [00:00,24:00) local em UTC', async () => {
  let captured = null;
  setHandler(async (timeMin, timeMax) => {
    captured = { timeMin, timeMax };
    return [];
  });

  const result = await resolveCalendarQuery(
    queryCalendarIntent(relativeDayWindow('today')),
    NOW_JAN,
    'America/Sao_Paulo',
  );

  assert.deepEqual(captured, {
    timeMin: '2024-01-15T03:00:00.000Z',
    timeMax: '2024-01-16T03:00:00.000Z',
  });
  assert.deepEqual(result, { status: 'available', scope: 'day' });
});

await check('4. relative_day tomorrow, dia inteiro, América/São_Paulo -> janela do dia seguinte', async () => {
  let captured = null;
  setHandler(async (timeMin, timeMax) => {
    captured = { timeMin, timeMax };
    return [];
  });

  const result = await resolveCalendarQuery(
    queryCalendarIntent(relativeDayWindow('tomorrow')),
    NOW_JAN,
    'America/Sao_Paulo',
  );

  assert.deepEqual(captured, {
    timeMin: '2024-01-16T03:00:00.000Z',
    timeMax: '2024-01-17T03:00:00.000Z',
  });
  assert.deepEqual(result, { status: 'available', scope: 'day' });
});

// ============================================================================
// 11. HORA ESPECÍFICA — janela de exatamente 1h
// ============================================================================

await check('5. relative_day today às 15h, América/São_Paulo -> janela [15:00,16:00) local em UTC', async () => {
  let captured = null;
  setHandler(async (timeMin, timeMax) => {
    captured = { timeMin, timeMax };
    return [];
  });

  const result = await resolveCalendarQuery(
    queryCalendarIntent(relativeDayWindow('today', { hour: 15, minute: 0 })),
    NOW_JAN,
    'America/Sao_Paulo',
  );

  assert.deepEqual(captured, {
    timeMin: '2024-01-15T18:00:00.000Z',
    timeMax: '2024-01-15T19:00:00.000Z',
  });
  assert.deepEqual(result, { status: 'available', scope: 'hour' });
});

// ============================================================================
// 12-13. DST — mesmo timezone (America/New_York), dois períodos do ano
// ============================================================================

await check('6. relative_day today, America/New_York em horário de verão (EDT, UTC-4)', async () => {
  let captured = null;
  setHandler(async (timeMin, timeMax) => {
    captured = { timeMin, timeMax };
    return [];
  });

  // now: 2024-07-15T18:00:00.000Z == 2024-07-15T14:00:00 em Nova York (EDT).
  const now = Date.parse('2024-07-15T18:00:00.000Z');
  await resolveCalendarQuery(queryCalendarIntent(relativeDayWindow('today')), now, 'America/New_York');

  assert.deepEqual(captured, {
    timeMin: '2024-07-15T04:00:00.000Z',
    timeMax: '2024-07-16T04:00:00.000Z',
  });
});

await check('7. relative_day today, America/New_York em horário padrão (EST, UTC-5)', async () => {
  let captured = null;
  setHandler(async (timeMin, timeMax) => {
    captured = { timeMin, timeMax };
    return [];
  });

  // now: 2024-01-15T18:00:00.000Z == 2024-01-15T13:00:00 em Nova York (EST)
  // — mesmo instante UTC do teste 3, timezone diferente: prova que o
  // offset correto (EST, não EDT) é escolhido a partir da data real, nunca
  // um deslocamento fixo hardcoded.
  const now = Date.parse('2024-01-15T18:00:00.000Z');
  await resolveCalendarQuery(queryCalendarIntent(relativeDayWindow('today')), now, 'America/New_York');

  assert.deepEqual(captured, {
    timeMin: '2024-01-15T05:00:00.000Z',
    timeMax: '2024-01-16T05:00:00.000Z',
  });
});

// ============================================================================
// 14-16. available / busy / busyBlockCount
// ============================================================================

await check('8. zero busy blocks -> available', async () => {
  setHandler(async () => []);
  const result = await resolveCalendarQuery(
    queryCalendarIntent(relativeDayWindow('today')),
    NOW_JAN,
    'America/Sao_Paulo',
  );
  assert.deepEqual(result, { status: 'available', scope: 'day' });
});

await check('9. 1 busy block -> busy, busyBlockCount: 1', async () => {
  setHandler(async () => [{ start: '2024-01-15T10:00:00.000Z', end: '2024-01-15T11:00:00.000Z' }]);
  const result = await resolveCalendarQuery(
    queryCalendarIntent(relativeDayWindow('today')),
    NOW_JAN,
    'America/Sao_Paulo',
  );
  assert.deepEqual(result, { status: 'busy', scope: 'day', busyBlockCount: 1 });
});

await check('10. 3 busy blocks -> busy, busyBlockCount: 3 (contagem real, nunca hardcoded)', async () => {
  setHandler(async () => [
    { start: '2024-01-15T10:00:00.000Z', end: '2024-01-15T11:00:00.000Z' },
    { start: '2024-01-15T14:00:00.000Z', end: '2024-01-15T15:00:00.000Z' },
    { start: '2024-01-15T20:00:00.000Z', end: '2024-01-15T20:30:00.000Z' },
  ]);
  const result = await resolveCalendarQuery(
    queryCalendarIntent(relativeDayWindow('today')),
    NOW_JAN,
    'America/Sao_Paulo',
  );
  assert.deepEqual(result, { status: 'busy', scope: 'day', busyBlockCount: 3 });
});

// ============================================================================
// 17. Google null -> error (não_conectado e falha técnica continuam
// indistinguíveis nesta fatia, de propósito — ver cabeçalho do arquivo)
// ============================================================================

await check('11. getGoogleCalendarBusyTimes null -> error', async () => {
  setHandler(async () => null);
  const result = await resolveCalendarQuery(
    queryCalendarIntent(relativeDayWindow('today')),
    NOW_JAN,
    'America/Sao_Paulo',
  );
  assert.deepEqual(result, { status: 'error' });
});

// ============================================================================
// 18. `now` inválido -> error, zero chamada ao Google
// ============================================================================

await check('12. now inválido (NaN) -> error, zero chamada ao Google', async () => {
  setHandler();
  const result = await resolveCalendarQuery(queryCalendarIntent(relativeDayWindow('today')), NaN, 'America/Sao_Paulo');
  assert.deepEqual(result, { status: 'error' });
});

// ============================================================================
// 19. Google chamado exatamente 1 vez por consulta válida
// ============================================================================

await check('13. Google chamado exatamente 1 vez para uma consulta válida', async () => {
  let calls = 0;
  setHandler(async () => {
    calls++;
    return [];
  });
  await resolveCalendarQuery(queryCalendarIntent(relativeDayWindow('today')), NOW_JAN, 'America/Sao_Paulo');
  assert.equal(calls, 1);
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
