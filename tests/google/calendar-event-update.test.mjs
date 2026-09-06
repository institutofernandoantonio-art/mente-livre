import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/lib/google/calendar-event-update.ts', import.meta.url)),
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

check('1. módulo é server-only e usa PATCH no calendário primary', () => {
  assert.ok(source.includes("'use server'"));
  assert.ok(source.includes("import 'server-only'"));
  assert.ok(source.includes("method: 'PATCH'"));
  assert.ok(source.includes('/calendars/primary/events/'));
});

check('2. id técnico é validado e URL-encoded antes de entrar na URL', () => {
  assert.ok(source.includes('isSafeGoogleEventId(googleEventId)'));
  assert.ok(source.includes('encodeURIComponent(googleEventId)'));
});

check('3. gate de autorização acontece antes do access token e do fetch', () => {
  const gate = source.indexOf('hasGoogleCalendarEventWriteAuthorization()');
  const token = source.indexOf('getGoogleCalendarAccessToken()');
  const fetchCall = source.indexOf('await fetch(');
  assert.ok(gate >= 0 && token > gate && fetchCall > token);
});

check('4. payload do PATCH contém somente start/end com dateTime/timeZone', () => {
  const bodyStart = source.indexOf('body: JSON.stringify({');
  const bodyEnd = source.indexOf('}),\n    });', bodyStart);
  assert.ok(bodyStart >= 0 && bodyEnd > bodyStart);
  const body = source.slice(bodyStart, bodyEnd);
  for (const required of ['start:', 'end:', 'dateTime:', 'timeZone']) {
    assert.ok(body.includes(required), `campo esperado ausente: ${required}`);
  }
  for (const forbidden of ['summary', 'description', 'attendees', 'location', 'reminders']) {
    assert.ok(!body.includes(forbidden), `campo inesperado no PATCH: ${forbidden}`);
  }
});

check('5. início/fim/timezone são validados antes de qualquer mutação', () => {
  assert.ok(source.includes('!isIsoInstant(start)'));
  assert.ok(source.includes('!isIsoInstant(end)'));
  assert.ok(source.includes('Date.parse(end) <= Date.parse(start)'));
  assert.ok(source.includes('!isValidTimeZone(timeZone)'));
});

check('6. 404/410 viram not_found; 401 pede autorização; 403 não é tratado como reconexão automática', () => {
  assert.ok(source.includes('response.status === 404 || response.status === 410'));
  assert.ok(source.includes("return { status: 'not_found' }"));
  assert.ok(source.includes('response.status === 401'));
  assert.ok(source.includes("return { status: 'authorization_required' }"));
  assert.ok(!source.includes('response.status === 403) {\n    return { status: \'authorization_required\' }'));
});

check('7. resultado público nunca devolve googleEventId ou token', () => {
  const typeBlock = source.slice(
    source.indexOf('export type UpdateGoogleCalendarEventTimeResult'),
    source.indexOf('// Primitiva mínima'),
  );
  assert.ok(!typeBlock.includes('googleEventId'));
  assert.ok(!typeBlock.includes('accessToken'));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
