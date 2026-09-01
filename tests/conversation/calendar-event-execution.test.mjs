// Testes unitários de src/lib/conversation/calendar-event-execution.ts.
//
// Execução: npm run test:calendar-event-execution
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão do resto de
// tests/conversation/. Duas peças são substituídas, nenhuma delas altera
// como o código de produção importa suas dependências:
//
// - `../google/calendar` (getGoogleCalendarAccessToken) — via
//   tests/support/fake-google-calendar.mjs, redirecionado só neste
//   processo de teste (ver tests/support/ts-extension-loader.mjs). Mesmo
//   specifier exato já usado por calendar-query.ts/
//   calendar-event-availability.ts.
// - `globalThis.fetch` (a chamada real POST à Calendar API) — substituição
//   direta, restaurada depois de cada teste, mesmo padrão já usado em
//   tests/conversation/intent-extraction.test.mjs. NENHUMA chamada real ao
//   Google acontece em execução alguma deste arquivo — todo teste que
//   chega ao ponto de chamar `fetch` primeiro configura um mock; nenhum
//   teste depende de rede real.
//
// Estes testes provam o CONTRATO desta primitiva (validação defensiva,
// payload exato enviado, mapeamento status HTTP -> resultado) — nunca o
// comportamento real da Calendar API do Google, que só uma chamada real
// (fora de escopo desta subfase) poderia provar.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { executeCreateCalendarEvent } from '../../src/lib/conversation/calendar-event-execution.ts';
import { handlers as googleHandlers } from '../support/fake-google-calendar.mjs';

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

const ORIGINAL_FETCH = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
}

const VALID_ACCESS_TOKEN = 'fake-access-token-nao-real';
// Inclui letras hex (a-f) de propósito — um id só de dígitos seria
// idêntico a si mesmo depois de .toUpperCase(), mascarando o teste 31
// abaixo (que depende de .toUpperCase() produzir um id INVÁLIDO).
const VALID_EVENT_ID = 'abcdef0123456789abcdef0123456789';

function setAccessToken(token) {
  googleHandlers.getGoogleCalendarAccessToken = async () => token;
}

function neverGetsAccessToken() {
  googleHandlers.getGoogleCalendarAccessToken = async () => {
    throw new Error('getGoogleCalendarAccessToken não deveria ter sido chamado para este caso');
  };
}

function jsonResponse(status) {
  return { status, ok: status >= 200 && status < 300, json: async () => ({}) };
}

function capturingFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return responder(url, options);
  };
  return calls;
}

function validEvent(overrides = {}) {
  return {
    title: 'Reunião com o time',
    description: 'Pauta: roadmap do trimestre',
    start: '2026-09-02T14:00:00.000Z',
    end: '2026-09-02T14:30:00.000Z',
    timezone: 'America/Sao_Paulo',
    reminderMinutesBeforeStart: 30,
    ...overrides,
  };
}

// ============================================================================
// 1-4, 35. UMA chamada, endpoint exato, Authorization Bearer
// ============================================================================

await check('1 e 35. input correto gera exatamente 1 POST (Google chamado 1 única vez)', async () => {
  setAccessToken(VALID_ACCESS_TOKEN);
  const calls = capturingFetch(() => jsonResponse(200));
  await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.equal(calls.length, 1);
});

await check('2. endpoint é exatamente /calendars/primary/events', async () => {
  setAccessToken(VALID_ACCESS_TOKEN);
  const calls = capturingFetch(() => jsonResponse(200));
  await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.equal(calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events');
});

await check('3. zero calendarId arbitrário — input público não aceita esse campo, URL nunca o contém', () => {
  const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/calendar-event-execution.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const typeMatch = source.match(/export type ExecuteCreateCalendarEventInput = \{([\s\S]*?)\n\};/);
  assert.ok(typeMatch, 'tipo de input público não encontrado');
  assert.ok(!/calendarId/i.test(typeMatch[1]));
  assert.ok(source.includes("'https://www.googleapis.com/calendar/v3/calendars/primary/events'"));
});

await check('4. Authorization Bearer é usado server-side, method POST', async () => {
  setAccessToken(VALID_ACCESS_TOKEN);
  const calls = capturingFetch(() => jsonResponse(200));
  await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, `Bearer ${VALID_ACCESS_TOKEN}`);
  assert.equal(calls[0].options.headers['content-type'], 'application/json');
});

// ============================================================================
// 5-6. Token nunca aparece no retorno
// ============================================================================

await check('5 e 6. access token e refresh token nunca aparecem no retorno da função', async () => {
  setAccessToken(VALID_ACCESS_TOKEN);
  capturingFetch(() => jsonResponse(200));
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(VALID_ACCESS_TOKEN));
  assert.ok(!/token/i.test(serialized));
  assert.deepEqual(result, { status: 'created' });
});

await check('6b. código real nunca referencia refresh_token (essa lógica pertence só a ../google/calendar)', () => {
  const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/calendar-event-execution.ts', import.meta.url));
  const codeOnly = readFileSync(sourcePath, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  assert.ok(!codeOnly.includes('refresh_token'));
  assert.ok(!codeOnly.includes('refreshGoogleAccessToken'));
});

// ============================================================================
// 7-22. Payload exato enviado ao Google
// ============================================================================

async function capturedBody(eventOverrides = {}) {
  setAccessToken(VALID_ACCESS_TOKEN);
  const calls = capturingFetch(() => jsonResponse(200));
  await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent(eventOverrides) });
  return JSON.parse(calls[0].options.body);
}

await check('7. body contém id = googleEventId', async () => {
  const body = await capturedBody();
  assert.equal(body.id, VALID_EVENT_ID);
});

await check('8. summary correto (= event.title)', async () => {
  const body = await capturedBody({ title: 'Título distintivo' });
  assert.equal(body.summary, 'Título distintivo');
});

await check('9. description presente quando fornecida', async () => {
  const body = await capturedBody({ description: 'Descrição distintiva' });
  assert.equal(body.description, 'Descrição distintiva');
});

await check('10. description omitida (chave ausente, nunca null) quando event.description é null', async () => {
  const body = await capturedBody({ description: null });
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'description'), 'chave description não deveria existir no JSON');
});

await check('11 e 12. start.dateTime e start.timeZone corretos', async () => {
  const body = await capturedBody({
    start: '2026-10-05T09:00:00.000Z',
    end: '2026-10-05T09:30:00.000Z',
    timezone: 'America/New_York',
  });
  assert.equal(body.start.dateTime, '2026-10-05T09:00:00.000Z');
  assert.equal(body.start.timeZone, 'America/New_York');
});

await check('13 e 14. end.dateTime e end.timeZone corretos', async () => {
  const body = await capturedBody({
    start: '2026-10-05T09:00:00.000Z',
    end: '2026-10-05T09:30:00.000Z',
    timezone: 'America/New_York',
  });
  assert.equal(body.end.dateTime, '2026-10-05T09:30:00.000Z');
  assert.equal(body.end.timeZone, 'America/New_York');
});

await check('15, 16, 17 e 18. reminders: useDefault=false, exatamente 1 override, method=popup, minutes=30', async () => {
  const body = await capturedBody();
  assert.equal(body.reminders.useDefault, false);
  assert.equal(body.reminders.overrides.length, 1);
  assert.equal(body.reminders.overrides[0].method, 'popup');
  assert.equal(body.reminders.overrides[0].minutes, 30);
});

await check('19, 20, 21 e 22. zero attendees/conferenceData/recurrence/location no payload', async () => {
  const body = await capturedBody();
  assert.equal(body.attendees, undefined);
  assert.equal(body.conferenceData, undefined);
  assert.equal(body.recurrence, undefined);
  assert.equal(body.location, undefined);
});

await check('payload contém SOMENTE as chaves esperadas (id/summary/description/start/end/reminders)', async () => {
  const body = await capturedBody();
  assert.deepEqual(Object.keys(body).sort(), ['description', 'end', 'id', 'reminders', 'start', 'summary']);
});

// ============================================================================
// 23-30. Mapeamento status HTTP -> resultado
// ============================================================================

await check('23. HTTP 200 -> created', async () => {
  setAccessToken(VALID_ACCESS_TOKEN);
  capturingFetch(() => jsonResponse(200));
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.deepEqual(result, { status: 'created' });
});

await check('24. HTTP 201 -> created', async () => {
  setAccessToken(VALID_ACCESS_TOKEN);
  capturingFetch(() => jsonResponse(201));
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.deepEqual(result, { status: 'created' });
});

await check('25. HTTP 409 -> already_exists (sucesso idempotente, mesmo id determinístico)', async () => {
  setAccessToken(VALID_ACCESS_TOKEN);
  capturingFetch(() => jsonResponse(409));
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.deepEqual(result, { status: 'already_exists' });
});

await check('26 e 36. HTTP 409 não faz GET/retry — exatamente 1 chamada fetch', async () => {
  let fetchCalls = 0;
  setAccessToken(VALID_ACCESS_TOKEN);
  globalThis.fetch = async () => {
    fetchCalls++;
    return jsonResponse(409);
  };
  await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.equal(fetchCalls, 1);
});

await check('27. HTTP 401 -> unauthorized', async () => {
  setAccessToken(VALID_ACCESS_TOKEN);
  capturingFetch(() => jsonResponse(401));
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.deepEqual(result, { status: 'unauthorized' });
});

await check(
  '28. HTTP 403 -> error, NUNCA unauthorized (correção desta subfase: 403 pode ser quota/permissão operacional, não só escopo insuficiente)',
  async () => {
    setAccessToken(VALID_ACCESS_TOKEN);
    capturingFetch(() => jsonResponse(403));
    const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
    assert.deepEqual(result, { status: 'error' });
    assert.notEqual(result.status, 'unauthorized');
  },
);

await check('HTTP 429 (quota/rate limit) -> error', async () => {
  setAccessToken(VALID_ACCESS_TOKEN);
  capturingFetch(() => jsonResponse(429));
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.deepEqual(result, { status: 'error' });
});

await check('29. HTTP 500 -> error', async () => {
  setAccessToken(VALID_ACCESS_TOKEN);
  capturingFetch(() => jsonResponse(500));
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.deepEqual(result, { status: 'error' });
});

await check('30. falha de rede (fetch rejeita) -> error, nunca propaga exceção', async () => {
  setAccessToken(VALID_ACCESS_TOKEN);
  globalThis.fetch = async () => {
    throw new Error('falha de rede simulada');
  };
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.deepEqual(result, { status: 'error' });
});

await check('sem access token (getGoogleCalendarAccessToken -> null) -> unauthorized, zero fetch', async () => {
  setAccessToken(null);
  const calls = capturingFetch(() => jsonResponse(200));
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.deepEqual(result, { status: 'unauthorized' });
  assert.equal(calls.length, 0);
});

// ============================================================================
// 31-34. Validação defensiva ANTES de qualquer chamada — zero fetch
// ============================================================================

await check('31. googleEventId inválido (formato) -> error, zero fetch, zero acesso a token', async () => {
  neverGetsAccessToken();
  const calls = capturingFetch(() => jsonResponse(200));
  for (const bad of ['NAO-E-UM-ID', VALID_EVENT_ID.toUpperCase(), VALID_EVENT_ID.slice(0, 31), VALID_EVENT_ID + 'z', '', 123]) {
    const result = await executeCreateCalendarEvent({ googleEventId: bad, event: validEvent() });
    assert.deepEqual(result, { status: 'error' }, `deveria rejeitar: ${JSON.stringify(bad)}`);
  }
  assert.equal(calls.length, 0);
});

await check('32. start/end inválidos (não-ISO ou end <= start) -> error, zero fetch', async () => {
  neverGetsAccessToken();
  const calls = capturingFetch(() => jsonResponse(200));
  const cases = [
    validEvent({ start: 'não é uma data' }),
    validEvent({ end: 'não é uma data' }),
    validEvent({ start: '2026-09-02T14:30:00.000Z', end: '2026-09-02T14:00:00.000Z' }), // end < start
    validEvent({ start: '2026-09-02T14:00:00.000Z', end: '2026-09-02T14:00:00.000Z' }), // end === start
  ];
  for (const event of cases) {
    const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event });
    assert.deepEqual(result, { status: 'error' });
  }
  assert.equal(calls.length, 0);
});

await check('33. timezone inválida -> error, zero fetch', async () => {
  neverGetsAccessToken();
  const calls = capturingFetch(() => jsonResponse(200));
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent({ timezone: 'Not/AValidTimeZone' }) });
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
});

await check('34. reminderMinutesBeforeStart diferente de 30 -> error, zero fetch', async () => {
  neverGetsAccessToken();
  const calls = capturingFetch(() => jsonResponse(200));
  for (const bad of [15, 60, 0, -30]) {
    const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent({ reminderMinutesBeforeStart: bad }) });
    assert.deepEqual(result, { status: 'error' });
  }
  assert.equal(calls.length, 0);
});

await check('título vazio -> aceito (documenta comportamento herdado de isValidProposedCalendarEventEvent, nunca uma regra nova aqui)', async () => {
  // título vazio ainda é uma string válida estruturalmente para o
  // validador reaproveitado (que só exige typeof === 'string', mesma
  // regra de runtime-state-validation.ts) — este teste documenta esse
  // comportamento HERDADO (a regra de negócio "título não pode ser vazio"
  // não existe em runtime-state-validation.ts, então este módulo
  // deliberadamente não a inventa aqui, para nunca divergir da fronteira
  // real). Por isso, diferente dos testes 31-34, este caso É esperado
  // chegar ao Google.
  setAccessToken(VALID_ACCESS_TOKEN);
  const calls = capturingFetch(() => jsonResponse(200));
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent({ title: '' }) });
  assert.deepEqual(result, { status: 'created' });
  assert.equal(calls.length, 1);
});

await check('event com chave extra/faltante -> error, zero fetch (hasExactKeys reaproveitado)', async () => {
  neverGetsAccessToken();
  const calls = capturingFetch(() => jsonResponse(200));
  const withExtraKey = { ...validEvent(), extra: 'campo não deveria existir' };
  const result = await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: withExtraKey });
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
});

// ============================================================================
// 37-40. Zero requery, zero admin/service-role novo, server-only, zero OAuth
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/calendar-event-execution.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

await check('37. zero requery — nenhuma segunda chamada a getGoogleCalendarAccessToken ou fetch por execução', async () => {
  let accessTokenCalls = 0;
  let fetchCalls = 0;
  googleHandlers.getGoogleCalendarAccessToken = async () => {
    accessTokenCalls++;
    return VALID_ACCESS_TOKEN;
  };
  globalThis.fetch = async () => {
    fetchCalls++;
    return jsonResponse(409);
  };
  await executeCreateCalendarEvent({ googleEventId: VALID_EVENT_ID, event: validEvent() });
  assert.equal(accessTokenCalls, 1);
  assert.equal(fetchCalls, 1);
});

await check('38. zero admin/service-role novo no código real (usa só getGoogleCalendarAccessToken)', () => {
  const forbidden = ['createAdminClient', 'service_role', 'SUPABASE_SECRET_KEY', 'createClient('];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
  assert.ok(codeOnly.includes('getGoogleCalendarAccessToken('));
});

await check('39. módulo é server-only', () => {
  assert.ok(codeOnly.includes("import 'server-only'"));
});

await check('40. nenhuma alteração de OAuth/scope neste arquivo (zero menção a scope/GOOGLE_CALENDAR_SCOPES)', () => {
  assert.ok(!codeOnly.includes('GOOGLE_CALENDAR_SCOPES'));
  assert.ok(!/searchParams\.set\('scope'/.test(codeOnly));
  assert.ok(!codeOnly.includes('GOOGLE_CLIENT_SECRET'));
});

await check('nenhum console.log/erro bruto do Google propagado', () => {
  assert.ok(!codeOnly.includes('console.'));
  assert.ok(!/response\.json\(\)/.test(codeOnly), 'esta função nunca deveria ler o corpo da resposta do Google');
});

// ============================================================================
// 41. proposal-turn.ts continua sem importar/chamar este executor
// ============================================================================

await check('41. proposal-turn.ts não importa nem chama executeCreateCalendarEvent (zero wiring nesta subfase)', () => {
  const proposalTurnPath = fileURLToPath(new URL('../../src/lib/conversation/proposal-turn.ts', import.meta.url));
  const proposalTurnCode = readFileSync(proposalTurnPath, 'utf8');
  assert.ok(!proposalTurnCode.includes('calendar-event-execution'));
  assert.ok(!proposalTurnCode.includes('executeCreateCalendarEvent'));
});

// --- Resumo -------------------------------------------------------------

restoreFetch();
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
