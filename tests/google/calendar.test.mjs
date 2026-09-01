// Auditoria estática de src/lib/google/calendar.ts — escopo OAuth do
// Google Calendar (correção de menor privilégio: freebusy-only).
//
// Execução: npm run test:google-calendar
//
// Por que auditoria estática, não teste dinâmico: `calendar.ts` tem
// `import 'server-only'` + `next/headers`/`next/navigation` no topo —
// mesmo padrão já usado em toda `src/app/`/`src/lib/` que depende do
// runtime do Next.js (ver tests/tarefas/tasks-actions.test.mjs). Nenhum
// dublê existe para esses módulos nativos do Next; ler o arquivo-fonte
// real e auditar sua estrutura evita inventar uma abstração de teste sem
// precedente.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Remove comentários de linha SEM confundir com `//` de dentro de uma URL
// literal (`https://...`) — `(?<!:)` garante que só um `//` NÃO precedido
// por `:` é tratado como início de comentário. Necessário aqui porque este
// arquivo, ao contrário da maioria já auditada no projeto, precisa inspecionar
// o valor exato de URLs (`https://www.googleapis.com/...`) linha a linha.
function stripComments(source) {
  return source
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n');
}

const sourcePath = fileURLToPath(new URL('../../src/lib/google/calendar.ts', import.meta.url));
const codeOnly = stripComments(readFileSync(sourcePath, 'utf8'));

const callbackPath = fileURLToPath(
  new URL('../../src/app/conectar-google-calendar/callback/route.ts', import.meta.url),
);
const callbackCodeOnly = stripComments(readFileSync(callbackPath, 'utf8'));

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

// ============================================================================
// 1-3. Escopo solicitado — só freebusy, nunca calendar.events (write)
// ============================================================================

check('1. GOOGLE_CALENDAR_SCOPES é EXATAMENTE calendar.events.freebusy, nenhum outro escopo concatenado', () => {
  const match = codeOnly.match(/const GOOGLE_CALENDAR_SCOPES = '([^']*)'/);
  assert.ok(match, 'GOOGLE_CALENDAR_SCOPES não encontrado');
  assert.equal(
    match[1],
    'https://www.googleapis.com/auth/calendar.events.freebusy',
    'escopo deve ser exatamente a string de freebusy, sem espaço/segundo escopo concatenado',
  );
});

check('2. zero escopo de escrita (calendar.events, sem o sufixo .freebusy) solicitado', () => {
  // Checagem precisa: 'calendar.events.freebusy' CONTÉM a substring
  // 'calendar.events' — por isso o teste busca especificamente pelo
  // escopo de escrita como token isolado (delimitado por espaço/aspas),
  // nunca um simples `.includes('calendar.events')` ingênuo (que daria
  // falso positivo já na própria string de freebusy).
  const writeScopePattern = /auth\/calendar\.events(?!\.freebusy)/;
  assert.ok(
    !writeScopePattern.test(codeOnly),
    'escopo de escrita calendar.events (sem .freebusy) não deveria mais ser solicitado',
  );
});

check('3. escopo é de fato usado na URL de autorização (authorizeUrl.searchParams)', () => {
  assert.ok(codeOnly.includes("authorizeUrl.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES)"));
});

// ============================================================================
// 4. Mecânica OAuth preservada — access_type/prompt/state/CSRF intactos
// ============================================================================

check('4. access_type=offline, prompt=consent e state (CSRF) continuam presentes, inalterados', () => {
  assert.ok(codeOnly.includes("authorizeUrl.searchParams.set('access_type', 'offline')"));
  assert.ok(codeOnly.includes("authorizeUrl.searchParams.set('prompt', 'consent')"));
  assert.ok(codeOnly.includes("authorizeUrl.searchParams.set('state', state)"));
  assert.ok(codeOnly.includes('randomBytes(32)'));
  assert.ok(codeOnly.includes('STATE_COOKIE_NAME'));
});

// ============================================================================
// 5. Zero Calendar write em todo o arquivo — invariante já existente,
// reafirmada nesta correção
// ============================================================================

check('5. zero chamada de escrita ao Google Calendar (events.insert/update/delete) no arquivo', () => {
  // A única chamada à API do Google Calendar em todo o arquivo deve ser a
  // de freeBusy — qualquer segunda chamada (ex. criar/editar evento)
  // apareceria aqui como uma segunda entrada.
  const postCallsToCalendarApi = codeOnly.match(/fetch\('https:\/\/www\.googleapis\.com\/calendar[^']*'/g) ?? [];
  assert.equal(postCallsToCalendarApi.length, 1, 'deve haver exatamente 1 chamada à API do Calendar (freeBusy)');
  assert.ok(postCallsToCalendarApi[0].includes('/freeBusy'));
});

// ============================================================================
// 6. Callback nunca exigiu (e continua sem exigir) calendar.events
// ============================================================================

check('6. callback de OAuth não referencia nem exige calendar.events em nenhum ponto', () => {
  assert.ok(!callbackCodeOnly.includes('calendar.events'), 'callback não deveria referenciar o escopo de escrita');
  assert.ok(!callbackCodeOnly.includes('scope'), 'callback não deveria validar/ler scope — token exchange já basta');
});

// ============================================================================
// 7-9. getGoogleCalendarAccessToken (Subfase 6 — primitiva segura de
// escrita events.insert): extraído de dentro de getGoogleCalendarBusyTimes,
// EXPORTADO para reuso, sem duplicar refresh/lookup em lugar nenhum.
// ============================================================================

check('7. getGoogleCalendarAccessToken é exportado (reutilizável pela futura escrita de eventos)', () => {
  assert.ok(/export async function getGoogleCalendarAccessToken\(\)/.test(codeOnly));
});

check('8. getGoogleCalendarBusyTimes REUTILIZA getGoogleCalendarAccessToken — nunca duplica lookup/refresh', () => {
  const fnMatch = codeOnly.match(/export async function getGoogleCalendarBusyTimes\([\s\S]*?\n\}/);
  assert.ok(fnMatch, 'getGoogleCalendarBusyTimes não encontrada');
  const body = fnMatch[0];
  assert.ok(body.includes('await getGoogleCalendarAccessToken()'));
  // Nenhuma segunda leitura de google_calendar_connections/admin client
  // dentro desta função — essa lógica agora vive só dentro de
  // getGoogleCalendarAccessToken.
  assert.ok(!body.includes('createAdminClient'));
  assert.ok(!body.includes('google_calendar_connections'));
});

check('9. refreshGoogleAccessToken (troca do refresh_token por access token) é chamada de UM só lugar — dentro de getGoogleCalendarAccessToken', () => {
  const callSites = [...codeOnly.matchAll(/refreshGoogleAccessToken\(/g)];
  // 1 na definição da função + 1 na única chamada real (dentro de
  // getGoogleCalendarAccessToken) — nunca uma segunda chamada em
  // getGoogleCalendarBusyTimes ou em qualquer outro lugar do arquivo.
  const definitionMatch = codeOnly.match(/async function refreshGoogleAccessToken\(/g) ?? [];
  assert.equal(callSites.length - definitionMatch.length, 1, 'refreshGoogleAccessToken deveria ser CHAMADA exatamente 1 vez em todo o arquivo');
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
