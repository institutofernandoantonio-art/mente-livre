import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/lib/google/calendar-event-targets.ts', import.meta.url)),
  'utf8',
);

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

check('consulta somente a agenda primary', () => {
  assert.ok(source.includes('/calendars/primary/events'));
  assert.ok(!source.includes('calendarId'));
});

check('id técnico existe só no módulo server-only de resolução', () => {
  assert.ok(source.includes("import 'server-only'"));
  assert.ok(source.includes("'use server'"));
  assert.ok(source.includes('googleEventId'));
  assert.ok(source.includes('event.id'));
});

check('campos lidos são mínimos para identificar e confirmar o alvo', () => {
  assert.ok(source.includes("items(id,summary,status,start(date,dateTime),end(date,dateTime))"));
  for (const forbidden of ['description', 'attendees', 'location', 'attachments', 'conferenceData', 'creator', 'organizer']) {
    assert.ok(!source.includes(forbidden), `campo desnecessário encontrado: ${forbidden}`);
  }
});

check('token nunca é retornado nem persistido', () => {
  assert.ok(source.includes('getGoogleCalendarAccessToken()'));
  assert.ok(source.includes("cache: 'no-store'"));
  assert.ok(!source.includes(".from('"));
  assert.ok(!source.includes('createAdminClient'));
  assert.ok(!/return\s+.*accessToken/.test(source));
});

check('janela e quantidade são limitadas', () => {
  assert.ok(source.includes("url.searchParams.set('timeMin', timeMin)"));
  assert.ok(source.includes("url.searchParams.set('timeMax', timeMax)"));
  assert.ok(source.includes("url.searchParams.set('maxResults', String(clampMaxResults(maxResults)))"));
  assert.ok(source.includes('Math.min(Math.max(value, 1), 10)'));
});

check('401/403 nunca são tratados como agenda vazia', () => {
  assert.ok(source.includes('response.status === 401 || response.status === 403'));
  assert.ok(source.includes("status: 'permissions'"));
});

check('nenhum DELETE/POST/PATCH é executado nesta camada de leitura', () => {
  assert.ok(source.includes("method: 'GET'"));
  assert.ok(!source.includes("method: 'DELETE'"));
  assert.ok(!source.includes("method: 'POST'"));
  assert.ok(!source.includes("method: 'PATCH'"));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
