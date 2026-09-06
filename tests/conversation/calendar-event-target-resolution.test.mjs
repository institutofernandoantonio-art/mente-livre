import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../../src/lib/conversation/calendar-event-target-resolution.ts', import.meta.url)),
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

check('módulo é server-only e nunca executa mutação', () => {
  assert.ok(source.includes("import 'server-only'"));
  assert.ok(!source.includes("method: 'DELETE'"));
  assert.ok(!source.includes("method: 'POST'"));
  assert.ok(!source.includes('.update('));
  assert.ok(!source.includes('.delete('));
});

check('só aceita janela relative_day nesta primeira fatia', () => {
  assert.ok(source.includes("resolved.kind !== 'relative_day'"));
  assert.ok(source.includes("resolved.day === 'today' ? today : addCivilDays(today, 1)"));
});

check('hora explícita limita a busca a exatamente uma hora', () => {
  assert.ok(source.includes('new Date(start.utc.getTime() + 60 * 60_000)'));
});

check('dia sem hora usa os limites civis do timezone real', () => {
  assert.ok(source.includes('getCivilDateInTimeZone(now, timeZone)'));
  assert.ok(source.includes('resolveCivilDateTimeInTimeZone'));
  assert.ok(source.includes('addCivilDays(civilDay, 1)'));
});

check('referência já resolvida ou vazia nunca é aceita como autoridade', () => {
  assert.ok(source.includes('reference.resolvedId !== null'));
  assert.ok(source.includes("status: 'unsupported_reference'"));
  assert.ok(source.includes("normalizeForComparison(reference.raw) === ''"));
});

check('matching é conservador: exato primeiro, contains contíguo depois, nunca fuzzy', () => {
  const exactIndex = source.indexOf('const exact = candidates.filter');
  const containsIndex = source.indexOf('.includes(normalizedReference)');
  assert.ok(exactIndex >= 0 && containsIndex > exactIndex);
  for (const forbidden of ['levenshtein', 'similarity', 'fuzzy', 'localeCompare']) {
    assert.ok(!source.toLowerCase().includes(forbidden.toLowerCase()), `heurística proibida encontrada: ${forbidden}`);
  }
});

check('zero e múltiplos candidatos nunca viram escolha automática', () => {
  assert.ok(source.includes("if (matches.length === 0) return { status: 'not_found' }"));
  assert.ok(source.includes("if (matches.length > 1) return { status: 'ambiguous' }"));
  assert.ok(source.includes("return { status: 'resolved', target: matches[0] }"));
});

check('consulta recebe no máximo 10 candidatos e não expõe lista em ambiguidade', () => {
  assert.ok(/getGoogleCalendarEventTargetsInWindow\([\s\S]*?10,\s*\)/.test(source));
  assert.ok(!source.includes("{ status: 'ambiguous', candidates"));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
