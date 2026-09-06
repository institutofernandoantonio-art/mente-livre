import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/lib/google/calendar-event-delete.ts', import.meta.url)),
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

check('módulo é server-only', () => {
  assert.ok(source.includes("import 'server-only'"));
});

check('DELETE usa somente calendarId=primary e eventId codificado', () => {
  assert.ok(source.includes("encodeURIComponent(googleEventId)"));
  assert.ok(source.includes('/calendars/primary/events/${encodedEventId}'));
  assert.ok(!source.includes('calendarId'));
});

check('gate de autorização acontece antes do token e antes do DELETE', () => {
  const gate = source.indexOf('await hasGoogleCalendarEventWriteAuthorization()');
  const token = source.indexOf('await getGoogleCalendarAccessToken()');
  const deletion = source.indexOf("method: 'DELETE'");
  assert.ok(gate >= 0 && token > gate && deletion > token);
});

check('sem autorização de escrita nunca continua para mutação', () => {
  assert.ok(source.includes("authorization === 'unauthorized'"));
  assert.ok(source.includes("status: 'authorization_required'"));
});

check('id técnico é validado antes de qualquer I/O', () => {
  const validation = source.indexOf('if (!isSafeGoogleEventId(googleEventId))');
  const gate = source.indexOf('await hasGoogleCalendarEventWriteAuthorization()');
  assert.ok(validation >= 0 && gate > validation);
  assert.ok(source.includes('!/[\\s/\\\\?#]/.test(value)'));
});

check('status de sucesso e desaparecimento são distintos', () => {
  assert.ok(source.includes("response.status === 200 || response.status === 204"));
  assert.ok(source.includes("status: 'deleted'"));
  assert.ok(source.includes("response.status === 404 || response.status === 410"));
  assert.ok(source.includes("status: 'not_found'"));
});

check('403 não é tratado automaticamente como falta de autorização', () => {
  const unauthorizedBranch = source.indexOf('if (response.status === 401)');
  assert.ok(unauthorizedBranch >= 0);
  assert.ok(!source.includes('response.status === 401 || response.status === 403'));
});

check('nenhum body de resposta, token ou eventId é devolvido', () => {
  assert.ok(!source.includes('response.json('));
  assert.ok(!source.includes('response.text('));
  assert.ok(!source.includes('accessToken }'));
  assert.ok(!source.includes('googleEventId }'));
});

check('zero retry/requery dentro da primitiva', () => {
  assert.equal((source.match(/await hasGoogleCalendarEventWriteAuthorization\(\)/g) ?? []).length, 1);
  assert.equal((source.match(/await getGoogleCalendarAccessToken\(\)/g) ?? []).length, 1);
  assert.equal((source.match(/await fetch\(/g) ?? []).length, 1);
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
