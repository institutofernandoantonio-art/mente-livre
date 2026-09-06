import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/lib/conversation/calendar-reschedule-flow.ts', import.meta.url)),
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

check('1. fluxo é server-only e usa prefixos próprios de remarcação', () => {
  assert.ok(source.includes("import 'server-only'"));
  assert.ok(source.includes('__mente_livre_calendar_reschedule_v1__'));
  assert.ok(source.includes('__mente_livre_calendar_reschedule_claimed_v1__'));
});

check('2. origem é resolvida antes de montar snapshot e nunca por palpite', () => {
  const resolve = source.indexOf('await resolveGoogleCalendarEventTarget');
  const snapshot = source.indexOf('const snapshot: CalendarEventRescheduleSnapshot');
  assert.ok(resolve >= 0 && snapshot > resolve);
  assert.ok(source.includes("case 'ambiguous':"));
  assert.ok(source.includes("case 'not_found':"));
});

check('3. nova janela é consultada antes de persistir a confirmação', () => {
  const availability = source.indexOf('const destinationLookup = await getGoogleCalendarEventTargetsInWindow');
  const snapshot = source.indexOf('const snapshot: CalendarEventRescheduleSnapshot');
  const save = source.indexOf('await replaceRuntimeState');
  assert.ok(availability >= 0 && snapshot > availability && save > snapshot);
});

check('4. snapshot persistido não recebe googleEventId', () => {
  const block = source.slice(
    source.indexOf('const snapshot: CalendarEventRescheduleSnapshot'),
    source.indexOf('const expiresAt = getProposalExpiresAt'),
  );
  assert.ok(!block.includes('googleEventId'));
});

check('5. confirmação explícita não aceita "ok"', () => {
  const classifier = source.slice(
    source.indexOf('function classifyRescheduleConfirmation'),
    source.indexOf('function buildConfirmationQuestion'),
  );
  assert.ok(classifier.includes("'sim'"));
  assert.ok(classifier.includes("'confirmo'"));
  assert.ok(!classifier.includes("'ok'"));
});

check('6. claim CAS acontece antes da revalidação/mutação externa', () => {
  const claim = source.indexOf('await advanceRuntimeState');
  const execute = source.indexOf('await rescheduleCalendarEventFromSnapshot');
  assert.ok(claim >= 0 && execute > claim);
});

check('7. branch claimed nunca executa mutação de novo', () => {
  const claimedCheck = source.indexOf('raw.startsWith(CLAIMED_PREFIX)');
  const execute = source.indexOf('await rescheduleCalendarEventFromSnapshot');
  assert.ok(claimedCheck >= 0 && execute > claimedCheck);
  assert.ok(source.includes("return { status: 'handled', result: { status: 'conflict' } }"));
});

check('8. sucesso do Google é comunicado sem expor ids internos', () => {
  assert.ok(source.includes('Compromisso remarcado no Google Agenda.'));
  assert.ok(!source.includes('question: sourceEventId'));
  assert.ok(!source.includes('question: target.googleEventId'));
});

check('9. módulo nunca faz PATCH/DELETE diretamente', () => {
  assert.ok(!source.includes("method: 'PATCH'"));
  assert.ok(!source.includes("method: 'DELETE'"));
});

check('10. versão inicial limita origem a hoje/amanhã antes de "para"', () => {
  assert.ok(source.includes('buildSourceWindowBeforePara'));
  assert.ok(source.includes("day: 'today' | 'tomorrow'"));
  assert.ok(source.includes('const lastPara = paraMatches.at(-1)'));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
