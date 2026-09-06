import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/lib/conversation/conversation-entry.ts', import.meta.url)),
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

check('1. entry importa somente a fronteira especializada de remarcação', () => {
  assert.ok(source.includes("from './calendar-reschedule-flow'"));
  assert.ok(source.includes('startCalendarReschedule'));
  assert.ok(source.includes('handleCalendarRescheduleRuntime'));
});

check('2. reschedule_event é interceptado antes do first-turn genérico', () => {
  const intentBranch = source.indexOf("extraction.intent.intentType === 'reschedule_event'");
  const start = source.indexOf('return startCalendarReschedule', intentBranch);
  const generic = source.indexOf('resolveFirstConversationalTurn', start);
  assert.ok(intentBranch >= 0 && start > intentBranch && generic > start);
});

check('3. runtime de remarcação é tratado antes da clarification genérica', () => {
  const handler = source.indexOf('await handleCalendarRescheduleRuntime');
  const handled = source.indexOf("calendarReschedule.status === 'handled'", handler);
  const generic = source.indexOf('resolveClarificationConversationalTurn', handled);
  assert.ok(handler >= 0 && handled > handler && generic > handled);
});

check('4. cancelamento existente continua roteado antes e independentemente', () => {
  const cancel = source.indexOf('await handleCalendarCancellationRuntime');
  const reschedule = source.indexOf('await handleCalendarRescheduleRuntime');
  assert.ok(cancel >= 0 && reschedule > cancel);
});

check('5. entry não executa PATCH nem DELETE diretamente', () => {
  assert.ok(!source.includes("method: 'PATCH'"));
  assert.ok(!source.includes("method: 'DELETE'"));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
