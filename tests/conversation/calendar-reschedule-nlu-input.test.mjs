import assert from 'node:assert/strict';
import { prepareCalendarRescheduleNluInput } from '../../src/lib/conversation/calendar-reschedule-nlu-input.ts';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`[PASS] ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`[FAIL] ${name} — ${error.message}`);
  }
}

await check('1. remove somente horário de origem em "hoje 15h para 16h"', () => {
  const result = prepareCalendarRescheduleNluInput('Mude a reunião com Gabriel de hoje às 15h para 16h.');
  assert.equal(result.transformed, true);
  assert.ok(result.text.includes('hoje'));
  assert.ok(result.text.includes('para 16h'));
  assert.ok(!result.text.includes('15h'));
  assert.ok(result.text.includes('reunião com Gabriel'));
});

await check('2. funciona com amanhã, minutos e destino 10h30', () => {
  const result = prepareCalendarRescheduleNluInput('Passe minha reunião de amanhã às 9h para 10h30.');
  assert.equal(result.transformed, true);
  assert.ok(!result.text.includes('9h'));
  assert.ok(result.text.includes('amanhã'));
  assert.ok(result.text.includes('10h30'));
});

await check('3. sem verbo inequívoco de remarcação -> texto intacto', () => {
  const text = 'Tenho reunião hoje às 15h para falar às 16h.';
  const result = prepareCalendarRescheduleNluInput(text);
  assert.deepEqual(result, { text, transformed: false });
});

await check('4. só um horário -> texto intacto', () => {
  const text = 'Mude a reunião de hoje para 16h.';
  const result = prepareCalendarRescheduleNluInput(text);
  assert.deepEqual(result, { text, transformed: false });
});

await check('5. sem hoje/amanhã na origem -> texto intacto, nunca infere dia', () => {
  const text = 'Mude a reunião das 15h para 16h.';
  const result = prepareCalendarRescheduleNluInput(text);
  assert.deepEqual(result, { text, transformed: false });
});

await check('6. sem "para" -> texto intacto', () => {
  const text = 'Remarque a reunião de hoje às 15h às 16h.';
  const result = prepareCalendarRescheduleNluInput(text);
  assert.deepEqual(result, { text, transformed: false });
});

await check('7. não modifica o texto original recebido', () => {
  const original = 'Mude a reunião de hoje às 15h para 16h.';
  const copy = `${original}`;
  prepareCalendarRescheduleNluInput(original);
  assert.equal(original, copy);
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
