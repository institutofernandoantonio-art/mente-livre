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
// 1-3. Escopos solicitados — Subfase 7 (ampliação controlada do OAuth):
// calendar.ts APENAS IMPORTA a lista centralizada de ./calendar-scopes —
// nunca a redefine. A auditoria da lista EM SI (quais 2 escopos, ausência
// de escopo mais amplo, zero duplicação) vive em
// tests/google/calendar-scopes.test.mjs, junto do arquivo que a declara.
// ============================================================================

check('1. calendar.ts IMPORTA GOOGLE_CALENDAR_REQUIRED_SCOPES de ./calendar-scopes — nunca a redefine', () => {
  assert.ok(codeOnly.includes("import { GOOGLE_CALENDAR_REQUIRED_SCOPES } from './calendar-scopes'"));
  assert.ok(!codeOnly.includes('export const GOOGLE_CALENDAR_REQUIRED_SCOPES'), 'a lista não deveria ser (re)definida aqui');
});

check(
  '2. nenhuma string de escopo solta/literal em calendar.ts fora do import — a URL só chega via GOOGLE_CALENDAR_REQUIRED_SCOPES.join',
  () => {
    // Nenhuma ocorrência de uma URL de escopo real (`auth/calendar...`)
    // deveria existir como literal neste arquivo — a única fonte é o
    // valor importado.
    assert.ok(!/'https:\/\/www\.googleapis\.com\/auth\/calendar/.test(codeOnly), 'string de escopo solta encontrada em calendar.ts');
  },
);

check('escopos concatenados com espaço (formato exigido pelo parâmetro scope da URL de autorização)', () => {
  assert.ok(codeOnly.includes('GOOGLE_CALENDAR_REQUIRED_SCOPES.join(\' \')'));
});

check('GOOGLE_CALENDAR_SCOPES (string local, resultado do join) nunca é exportado — só usado internamente por connectGoogleCalendar', () => {
  assert.ok(!codeOnly.includes('export const GOOGLE_CALENDAR_SCOPES'));
  assert.ok(!codeOnly.includes('export { GOOGLE_CALENDAR_SCOPES'));
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
// 6. Callback REUTILIZA a mesma lista centralizada — nunca duplica a
// string de escopo (correção/ampliação desta subfase: antes da Subfase 7
// o callback não precisava validar scope algum, porque só 1 escopo
// existia; agora que 2 são solicitados juntos, validar o que foi
// realmente concedido é obrigatório — ver "5. Callback VALIDA os escopos
// concedidos" abaixo).
// ============================================================================

check('6. callback IMPORTA GOOGLE_CALENDAR_REQUIRED_SCOPES de @/lib/google/calendar-scopes — nunca uma string de escopo solta/duplicada', () => {
  assert.ok(callbackCodeOnly.includes("import { GOOGLE_CALENDAR_REQUIRED_SCOPES } from '@/lib/google/calendar-scopes'"));
  // Nenhuma URL de escopo literal solta no callback — a ÚNICA fonte é o
  // import acima.
  assert.ok(!/https:\/\/www\.googleapis\.com\/auth\/calendar/.test(callbackCodeOnly));
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
