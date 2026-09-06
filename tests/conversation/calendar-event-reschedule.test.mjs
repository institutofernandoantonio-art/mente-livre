import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/lib/conversation/calendar-event-reschedule.ts', import.meta.url)),
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

check('1. snapshot público não contém googleEventId', () => {
  const typeBlock = source.slice(
    source.indexOf('export type CalendarEventRescheduleSnapshot'),
    source.indexOf('export type RescheduleCalendarEventFromSnapshotResult'),
  );
  assert.ok(!typeBlock.includes('googleEventId'));
});

check('2. revalida origem por título + início + fim exatos', () => {
  assert.ok(source.includes('event.title === snapshot.title'));
  assert.ok(source.includes('event.start === snapshot.originalStart'));
  assert.ok(source.includes('event.end === snapshot.originalEnd'));
});

check('3. zero e múltiplos matches nunca viram escolha automática', () => {
  assert.ok(source.includes('exactMatches.length === 0'));
  assert.ok(source.includes("return { status: 'not_found' }"));
  assert.ok(source.includes('exactMatches.length > 1'));
  assert.ok(source.includes("return { status: 'ambiguous' }"));
});

check('4. duração original é preservada exatamente', () => {
  assert.ok(source.includes('newEndMs - newStartMs !== originalEndMs - originalStartMs'));
  assert.ok(source.includes("return { status: 'unsupported' }"));
});

check('5. consulta destino depois de revalidar origem e antes do PATCH', () => {
  const sourceLookup = source.indexOf('const sourceLookup = await getGoogleCalendarEventTargetsInWindow');
  const exactMatch = source.indexOf('const exactMatches = sourceLookup.events.filter');
  const destinationLookup = source.indexOf('const destinationLookup = await getGoogleCalendarEventTargetsInWindow');
  const update = source.indexOf('await updateGoogleCalendarEventTimeById');
  assert.ok(sourceLookup >= 0 && exactMatch > sourceLookup && destinationLookup > exactMatch && update > destinationLookup);
});

check('6. disponibilidade ignora somente o próprio evento por id server-side', () => {
  assert.ok(source.includes('const sourceEventId = exactMatches[0].googleEventId'));
  assert.ok(source.includes('event.googleEventId !== sourceEventId'));
  assert.ok(source.includes('blockingEvents.length > 0'));
  assert.ok(source.includes("return { status: 'conflict' }"));
});

check('7. módulo nunca faz PATCH/DELETE diretamente', () => {
  assert.ok(!source.includes("method: 'PATCH'"));
  assert.ok(!source.includes("method: 'DELETE'"));
});

check('8. eventos de dia inteiro ficam fora desta versão', () => {
  assert.ok(source.includes('value.allDay !== false'));
});

check('9. status de autorização e erro nunca carregam dados do Google', () => {
  const typeBlock = source.slice(
    source.indexOf('export type RescheduleCalendarEventFromSnapshotResult'),
    source.indexOf('// Executa a alteração'),
  );
  for (const forbidden of ['googleEventId', 'token', 'events:', 'title:']) {
    assert.ok(!typeBlock.includes(forbidden), `campo proibido no resultado: ${forbidden}`);
  }
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
