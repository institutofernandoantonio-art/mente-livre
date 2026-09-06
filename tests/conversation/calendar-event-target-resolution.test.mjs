import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/lib/conversation/calendar-event-target-resolution.ts', import.meta.url)),
  'utf8',
);
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

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

check('módulo é server-only e nunca executa mutação', () => {
  assert.ok(codeOnly.includes("import 'server-only'"));
  assert.ok(!codeOnly.includes("method: 'DELETE'"));
  assert.ok(!codeOnly.includes("method: 'POST'"));
  assert.ok(!codeOnly.includes('.update('));
  assert.ok(!codeOnly.includes('.delete('));
});

check('só aceita janela relative_day nesta primeira fatia', () => {
  assert.ok(codeOnly.includes("resolved.kind !== 'relative_day'"));
  assert.ok(codeOnly.includes("resolved.day === 'today' ? today : addCivilDays(today, 1)"));
});

check('hora explícita limita a busca a exatamente uma hora', () => {
  assert.ok(codeOnly.includes('new Date(start.utc.getTime() + 60 * 60_000)'));
});

check('dia sem hora usa os limites civis do timezone real', () => {
  assert.ok(codeOnly.includes('getCivilDateInTimeZone(now, timeZone)'));
  assert.ok(codeOnly.includes('resolveCivilDateTimeInTimeZone'));
  assert.ok(codeOnly.includes('addCivilDays(civilDay, 1)'));
});

check('referência já resolvida ou vazia nunca é aceita como autoridade', () => {
  assert.ok(codeOnly.includes('reference.resolvedId !== null'));
  assert.ok(codeOnly.includes("status: 'unsupported_reference'"));
  assert.ok(codeOnly.includes("normalizeForComparison(reference.raw) === ''"));
});

check('matching é conservador: exato primeiro, contains contíguo depois, nunca fuzzy', () => {
  const exactIndex = codeOnly.indexOf('const exact = candidates.filter');
  const containsIndex = codeOnly.indexOf('.includes(normalizedReference)');
  assert.ok(exactIndex >= 0 && containsIndex > exactIndex);
  for (const forbidden of ['levenshtein', 'similarity', 'fuzzy', 'localeCompare']) {
    assert.ok(
      !codeOnly.toLowerCase().includes(forbidden.toLowerCase()),
      `heurística proibida encontrada no código executável: ${forbidden}`,
    );
  }
});

check('zero e múltiplos candidatos nunca viram escolha automática', () => {
  assert.ok(codeOnly.includes("if (matches.length === 0) return { status: 'not_found' }"));
  assert.ok(codeOnly.includes("if (matches.length > 1) return { status: 'ambiguous' }"));
  assert.ok(codeOnly.includes("return { status: 'resolved', target: matches[0] }"));
});

check('consulta recebe no máximo 10 candidatos e não expõe lista em ambiguidade', () => {
  assert.ok(/getGoogleCalendarEventTargetsInWindow\([\s\S]*?10,\s*\)/.test(codeOnly));
  assert.ok(!codeOnly.includes("{ status: 'ambiguous', candidates"));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
