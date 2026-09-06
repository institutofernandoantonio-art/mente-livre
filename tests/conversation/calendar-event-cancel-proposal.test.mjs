import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/lib/conversation/calendar-event-cancel-proposal.ts', import.meta.url)),
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

check('proposta não contém googleEventId', () => {
  const typeBlock = source.slice(
    source.indexOf('export type CalendarEventCancellationProposal'),
    source.indexOf('export type BuildCalendarEventCancellationProposalResult'),
  );
  assert.ok(!typeBlock.includes('googleEventId'));
});

check('ação proposta é explicitamente cancel_calendar_event', () => {
  assert.ok(source.includes("actionType: 'cancel_calendar_event'"));
});

check('alvo real é resolvido antes da proposta', () => {
  const resolve = source.indexOf('await resolveGoogleCalendarEventTarget');
  const proposed = source.indexOf("status: 'proposed',", resolve);
  assert.ok(resolve >= 0 && proposed > resolve);
});

check('ambiguidade e ausência nunca viram proposta', () => {
  assert.ok(source.includes("case 'ambiguous':"));
  assert.ok(source.includes("case 'not_found':"));
  assert.ok(source.includes("return { status: 'ambiguous' }"));
  assert.ok(source.includes("return { status: 'not_found' }"));
});

check('módulo não executa DELETE nem importa primitiva de exclusão', () => {
  assert.ok(!source.includes("method: 'DELETE'"));
  assert.ok(!source.includes('deleteGoogleCalendarEventById'));
  assert.ok(!source.includes('deleteCalendarEventFromSnapshot'));
});

check('snapshot mantém apenas dados necessários para confirmação/revalidação', () => {
  for (const required of ['title:', 'start:', 'end:', 'allDay:', 'timeZone:']) {
    assert.ok(source.includes(required), `campo ausente: ${required}`);
  }
  for (const forbidden of ['description:', 'attendees', 'location', 'token', 'userId']) {
    assert.ok(!source.includes(forbidden), `campo proibido: ${forbidden}`);
  }
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
