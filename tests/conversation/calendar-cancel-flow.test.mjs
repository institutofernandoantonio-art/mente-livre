import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/lib/conversation/calendar-cancel-flow.ts', import.meta.url)),
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

check('1. fluxo é server-only e nunca persiste googleEventId no runtime', () => {
  assert.ok(source.includes("import 'server-only'"));
  assert.ok(!source.includes('googleEventId'));
});

check('2. proposta usa snapshot mínimo e revalidação antes do DELETE', () => {
  assert.ok(source.includes('buildCalendarEventCancellationProposal'));
  assert.ok(source.includes('deleteCalendarEventFromSnapshot(snapshot)'));
  assert.ok(source.includes('title: proposal.action.event.title'));
  assert.ok(source.includes('start: proposal.action.event.start'));
  assert.ok(source.includes('end: proposal.action.event.end'));
  assert.ok(source.includes('timeZone: proposal.action.event.timeZone'));
});

check('3. confirmação destrutiva exige vocabulário explícito e não aceita ok', () => {
  assert.ok(source.includes("'pode cancelar'"));
  assert.ok(source.includes("'confirmo'"));
  assert.ok(source.includes("'nao'"));
  const confirmationBlock = source.slice(
    source.indexOf('function classifyDestructiveConfirmation'),
    source.indexOf('function buildConfirmationQuestion'),
  ).toLowerCase();
  assert.ok(!confirmationBlock.includes("'ok'"));
  assert.ok(!confirmationBlock.includes("'pode'"));
});

check('4. CAS de claim acontece antes de qualquer DELETE', () => {
  const advanceIndex = source.indexOf('await advanceRuntimeState');
  const deleteIndex = source.indexOf('await deleteCalendarEventFromSnapshot(snapshot)');
  assert.ok(advanceIndex >= 0 && deleteIndex > advanceIndex);
});

check('5. state claimed bloqueia confirmação concorrente e expira rápido', () => {
  assert.ok(source.includes('CLAIMED_PREFIX'));
  assert.ok(source.includes('CLAIM_TTL_MS = 60_000'));
  assert.ok(source.includes("return { status: 'handled', result: { status: 'conflict' } }"));
});

check('6. resposta não consome sem executar DELETE', () => {
  const noBranch = source.slice(
    source.indexOf("if (confirmation === 'no')"),
    source.indexOf('const claimedExpiresAt'),
  );
  assert.ok(noBranch.includes('consumeRuntimeState'));
  assert.ok(!noBranch.includes('deleteCalendarEventFromSnapshot'));
});

check('7. janela destrutiva é limitada a hoje/amanhã ou horário explícito de hoje', () => {
  assert.ok(source.includes("day = 'today'"));
  assert.ok(source.includes("day = 'tomorrow'"));
  assert.ok(source.includes('hasOtherDayReference'));
  assert.ok(source.includes("resolved: { kind: 'relative_day', day, time }"));
});

check('8. eventos de dia inteiro são recusados nesta primeira versão', () => {
  assert.ok(source.includes('proposal.action.event.allDay'));
  assert.ok(source.includes('não cancelo eventos de dia inteiro automaticamente'));
});

check('9. falhas/ambiguidade revalidada nunca viram exclusão alternativa', () => {
  assert.ok(source.includes("case 'not_found':"));
  assert.ok(source.includes("case 'ambiguous':"));
  assert.ok(!source.includes('retry'));
  assert.ok(!source.includes('similarity'));
  assert.ok(!source.includes('levenshtein'));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
