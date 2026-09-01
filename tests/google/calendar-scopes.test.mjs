// Auditoria estática de src/lib/google/calendar-scopes.ts — a lista
// canônica e centralizada dos escopos OAuth do Google Calendar (Subfase 7
// da criação de compromissos no Google Calendar: ampliação controlada do
// OAuth para escrita na agenda principal).
//
// Execução: npm run test:google-calendar-scopes
//
// Por que este arquivo é 100% puro (zero next/headers/server-only): só
// declara uma constante — pode ser lido/auditado como texto ou até
// importado dinamicamente sem qualquer dublê. Usamos leitura de texto
// aqui, mesmo padrão do resto de tests/google/, para manter um único
// estilo de auditoria em toda a pasta.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('../../src/lib/google/calendar-scopes.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
  .join('\n');

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

const listMatch = codeOnly.match(/export const GOOGLE_CALENDAR_REQUIRED_SCOPES = \[([\s\S]*?)\] as const;/);

check('0. GOOGLE_CALENDAR_REQUIRED_SCOPES é exportada como array `as const`', () => {
  assert.ok(listMatch, 'GOOGLE_CALENDAR_REQUIRED_SCOPES não encontrada');
});

const scopes = listMatch ? [...listMatch[1].matchAll(/'(https:\/\/www\.googleapis\.com\/auth\/[^']+)'/g)].map((m) => m[1]) : [];

check('1. contém freebusy', () => {
  assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.events.freebusy'));
});

check('2. contém o escopo mínimo de escrita aprovado (calendar.events.owned)', () => {
  assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.events.owned'));
});

check('3. contém EXATAMENTE 2 escopos', () => {
  assert.equal(scopes.length, 2, `esperava exatamente 2 escopos, encontrado: ${JSON.stringify(scopes)}`);
});

check('4. não contém `calendar` (escopo amplo — gerencia/apaga agendas inteiras)', () => {
  assert.ok(!scopes.includes('https://www.googleapis.com/auth/calendar'));
});

check('5. não contém escopo mais amplo desnecessário (calendar.events puro, sem .owned/.freebusy)', () => {
  assert.ok(!scopes.includes('https://www.googleapis.com/auth/calendar.events'));
});

check('6. nenhuma duplicação', () => {
  assert.equal(new Set(scopes).size, scopes.length, 'escopo duplicado encontrado');
});

check('7. zero escopo adicional/inesperado além dos 2 aprovados (readonly, calendars, acls, app.created, settings, etc.)', () => {
  const allowed = new Set([
    'https://www.googleapis.com/auth/calendar.events.freebusy',
    'https://www.googleapis.com/auth/calendar.events.owned',
  ]);
  for (const scope of scopes) {
    assert.ok(allowed.has(scope), `escopo não aprovado encontrado: ${scope}`);
  }
});

check('8. nenhuma string de escopo solta FORA da definição da lista neste arquivo (fonte única mesmo dentro do próprio arquivo)', () => {
  const withoutDefinition = codeOnly.replace(listMatch[0], '');
  assert.ok(!/auth\/calendar/.test(withoutDefinition), 'string de escopo solta fora da lista centralizada');
});

check('9. zero server-only/next/headers/Supabase/admin — arquivo 100% puro, só a constante', () => {
  const forbidden = ['server-only', 'next/headers', 'next/navigation', 'createClient', 'createAdminClient', 'fetch('];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
