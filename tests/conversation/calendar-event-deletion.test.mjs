import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/lib/conversation/calendar-event-deletion.ts', import.meta.url)),
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

check('snapshot público nunca contém googleEventId', () => {
  const typeBlock = source.slice(
    source.indexOf('export type CalendarEventDeletionSnapshot'),
    source.indexOf('export type DeleteCalendarEventFromSnapshotResult'),
  );
  assert.ok(!typeBlock.includes('googleEventId'));
});

check('id técnico só vem da nova leitura server-side', () => {
  assert.ok(source.includes('getGoogleCalendarEventTargetsInWindow'));
  assert.ok(source.includes('exactMatches[0].googleEventId'));
  assert.ok(source.includes('deleteGoogleCalendarEventById'));
});

check('revalidação exige match exato de título, início e fim', () => {
  assert.ok(source.includes('event.title === snapshot.title'));
  assert.ok(source.includes('event.start === snapshot.start'));
  assert.ok(source.includes('event.end === snapshot.end'));
});

check('zero ou múltiplos matches nunca executam exclusão', () => {
  const zero = source.indexOf('if (exactMatches.length === 0)');
  const many = source.indexOf('if (exactMatches.length > 1)');
  const deletion = source.indexOf('await deleteGoogleCalendarEventById');
  assert.ok(zero >= 0 && many > zero && deletion > many);
});

check('evento de dia inteiro é recusado nesta primeira versão', () => {
  assert.ok(source.includes('if (value.allDay)'));
  assert.ok(source.includes("return { status: 'unsupported' }"));
});

check('consulta é limitada a 10 candidatos e agenda real é consultada uma vez', () => {
  assert.ok(/getGoogleCalendarEventTargetsInWindow\([\s\S]*?10,\s*\)/.test(source));
  assert.equal((source.match(/await getGoogleCalendarEventTargetsInWindow\(/g) ?? []).length, 1);
});

check('DELETE só é chamado uma vez e só depois da revalidação', () => {
  assert.equal((source.match(/await deleteGoogleCalendarEventById\(/g) ?? []).length, 1);
  const exact = source.indexOf('const exactMatches = lookup.events.filter');
  const deletion = source.indexOf('await deleteGoogleCalendarEventById');
  assert.ok(exact >= 0 && deletion > exact);
});

check('mudança do compromisso falha fechado: nunca fallback por similaridade', () => {
  assert.ok(source.includes("status: 'not_found'"));
  for (const forbidden of ['includes(snapshot.title)', 'levenshtein', 'similarity', 'localeCompare']) {
    assert.ok(!source.toLowerCase().includes(forbidden.toLowerCase()), `fallback proibido encontrado: ${forbidden}`);
  }
});

check('nenhum token, id técnico ou candidato é devolvido nos resultados', () => {
  const resultBlock = source.slice(
    source.indexOf('export type DeleteCalendarEventFromSnapshotResult'),
    source.indexOf('// Revalida o alvo'),
  );
  assert.ok(!resultBlock.includes('googleEventId'));
  assert.ok(!resultBlock.includes('token'));
  assert.ok(!resultBlock.includes('candidate'));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
