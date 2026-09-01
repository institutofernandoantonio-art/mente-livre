// Testes puros de src/lib/conversation/timezone.ts — a ÚNICA implementação
// de conversão civil ↔ instante absoluto do projeto (extraída/centralizada
// na auditoria de horário de verão da Subfase 1 do Calendar).
//
// Execução: npm run test:timezone (node --experimental-strip-types, sem
// react-server: este módulo não tem 'server-only' nem qualquer dependência
// de Next.js/Supabase).
//
// Todas as datas são literais determinísticas (Date.UTC / strings ISO
// explícitas) — nenhum teste depende do timezone da máquina que roda o
// teste, nem de Date.now().

import assert from 'node:assert/strict';
import {
  isValidTimeZone,
  getCivilDateInTimeZone,
  addCivilDays,
  resolveCivilDateTimeInTimeZone,
} from '../../src/lib/conversation/timezone.ts';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

function check(name, fn) {
  try {
    fn();
    record(name, true);
  } catch (err) {
    record(name, false, err.message);
  }
}

check('1. America/Sao_Paulo é aceito', () => {
  assert.equal(isValidTimeZone('America/Sao_Paulo'), true);
});

check('2. timezone inexistente é rejeitado', () => {
  assert.equal(isValidTimeZone('Nao/Existe'), false);
});

check('3. string vazia é rejeitada', () => {
  assert.equal(isValidTimeZone(''), false);
});

check('4. string só de espaço é rejeitada', () => {
  assert.equal(isValidTimeZone('   '), false);
});

check('5. UTC é aceito', () => {
  assert.equal(isValidTimeZone('UTC'), true);
});

check('6. valores não-string são rejeitados (null/undefined/number)', () => {
  assert.equal(isValidTimeZone(null), false);
  assert.equal(isValidTimeZone(undefined), false);
  assert.equal(isValidTimeZone(123), false);
});

// ============================================================================
// resolveCivilDateTimeInTimeZone — o núcleo corrigido nesta subfase
// ============================================================================

check('7. horário normal/unívoco (America/Sao_Paulo, sem DST) resolve corretamente', () => {
  const result = resolveCivilDateTimeInTimeZone(2026, 9, 2, 14, 0, 'America/Sao_Paulo');
  assert.deepEqual(result, { status: 'resolved', utc: new Date('2026-09-02T17:00:00.000Z') });
});

check('8. DST spring-forward — horário existente DEPOIS da mudança (America/New_York, 2027-03-14 10:00 -> 14:00Z)', () => {
  // Caso concreto que motivou esta correção: a técnica anterior ("somar
  // horas desde a meia-noite local") produzia 15:00Z (11:00 local, 1h
  // errado) para este exato horário/dia.
  const result = resolveCivilDateTimeInTimeZone(2027, 3, 14, 10, 0, 'America/New_York');
  assert.deepEqual(result, { status: 'resolved', utc: new Date('2027-03-14T14:00:00.000Z') });
});

check('9. horário civil inexistente (America/New_York, 2027-03-14 02:30, lacuna de spring-forward) -> nonexistent', () => {
  // O relógio pula de 02:00 direto para 03:00 nesse dia — 02:30 nunca
  // acontece. Nunca deslocado silenciosamente para 03:30.
  const result = resolveCivilDateTimeInTimeZone(2027, 3, 14, 2, 30, 'America/New_York');
  assert.deepEqual(result, { status: 'nonexistent' });
});

check('10. horário civil ambíguo (America/New_York, 2027-11-07 01:30, sobreposição de fall-back) -> ambiguous', () => {
  // 01:30 acontece DUAS vezes nesse dia (uma em EDT, outra em EST) —
  // nunca escolhido arbitrariamente o primeiro ou o segundo.
  const result = resolveCivilDateTimeInTimeZone(2027, 11, 7, 1, 30, 'America/New_York');
  assert.deepEqual(result, { status: 'ambiguous' });
});

check('11. horário normal no MESMO dia do fall-back, fora da janela ambígua, continua correto (pós-transição, EST)', () => {
  const result = resolveCivilDateTimeInTimeZone(2027, 11, 7, 10, 0, 'America/New_York');
  // 10:00 EST = UTC-5 -> 15:00Z.
  assert.deepEqual(result, { status: 'resolved', utc: new Date('2027-11-07T15:00:00.000Z') });
});

check('11b. horário normal no MESMO dia do fall-back, ANTES da transição (EDT), continua correto', () => {
  const result = resolveCivilDateTimeInTimeZone(2027, 11, 7, 0, 30, 'America/New_York');
  // 00:30 EDT = UTC-4 -> 04:30Z.
  assert.deepEqual(result, { status: 'resolved', utc: new Date('2027-11-07T04:30:00.000Z') });
});

check('12. UTC (sem DST nunca) resolve trivialmente', () => {
  const result = resolveCivilDateTimeInTimeZone(2026, 1, 1, 0, 0, 'UTC');
  assert.deepEqual(result, { status: 'resolved', utc: new Date('2026-01-01T00:00:00.000Z') });
});

// ============================================================================
// getCivilDateInTimeZone / addCivilDays — dia civil, nunca 24h em ms
// ============================================================================

check('13. getCivilDateInTimeZone lê o dia civil do USUÁRIO perto da meia-noite UTC (America/Sao_Paulo)', () => {
  // 2026-09-01T02:00:00Z já é 1º de setembro em UTC, mas ainda é
  // 2026-08-31T23:00:00-03:00 em São Paulo.
  const civilDate = getCivilDateInTimeZone(new Date(Date.UTC(2026, 8, 1, 2, 0, 0)), 'America/Sao_Paulo');
  assert.deepEqual(civilDate, { year: 2026, month: 8, day: 31 });
});

check('14. addCivilDays avança o PRÓXIMO DIA CIVIL, mesmo num dia de 23h por DST (spring-forward)', () => {
  // 13 de março de 2027 + 1 dia civil deve ser 14 de março — mesmo o dia
  // 14 tendo só 23 horas reais (nunca soma 24h em ms, que erraria aqui).
  const civilDate = addCivilDays({ year: 2027, month: 3, day: 13 }, 1);
  assert.deepEqual(civilDate, { year: 2027, month: 3, day: 14 });
});

check('15. addCivilDays avança o PRÓXIMO DIA CIVIL num dia de 25h por DST (fall-back)', () => {
  const civilDate = addCivilDays({ year: 2027, month: 11, day: 6 }, 1);
  assert.deepEqual(civilDate, { year: 2027, month: 11, day: 7 });
});

check('16. addCivilDays normaliza virada de mês/ano corretamente', () => {
  assert.deepEqual(addCivilDays({ year: 2026, month: 8, day: 31 }, 1), { year: 2026, month: 9, day: 1 });
  assert.deepEqual(addCivilDays({ year: 2026, month: 12, day: 31 }, 1), { year: 2027, month: 1, day: 1 });
});

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
