import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(
  new URL('../../src/lib/google/upcoming-events.ts', import.meta.url),
);
const uiPath = fileURLToPath(
  new URL('../../src/app/entrada/UpcomingCalendarEvents.tsx', import.meta.url),
);

const server = readFileSync(serverPath, 'utf8');
const ui = readFileSync(uiPath, 'utf8');

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

check('consulta somente a agenda primary', () => {
  assert.ok(server.includes('/calendars/primary/events'));
});

check('próximos compromissos continuam limitados a 4 e ordenados pelo início', () => {
  assert.ok(server.includes('maxResults: 4'));
  assert.ok(server.includes("url.searchParams.set('maxResults', String(input.maxResults))"));
  assert.ok(server.includes("url.searchParams.set('singleEvents', 'true')"));
  assert.ok(server.includes("url.searchParams.set('orderBy', 'startTime')"));
  assert.ok(server.includes('timeMin: new Date().toISOString()'));
});

check('usa timezone validado do browser para a leitura/apresentação', () => {
  assert.ok(server.includes('isValidTimeZone(input.timeZone)'));
  assert.ok(server.includes("url.searchParams.set('timeZone', input.timeZone)"));
  assert.ok(ui.includes('Intl.DateTimeFormat().resolvedOptions().timeZone'));
});

check('token Google permanece no servidor e reutiliza a primitiva existente', () => {
  assert.ok(server.includes('getGoogleCalendarAccessToken()'));
  assert.ok(server.includes("import 'server-only'"));
  assert.ok(server.includes("'use server'"));
  assert.ok(!ui.includes('accessToken'));
  assert.ok(!ui.includes('authorization:'));
});

check('campos solicitados seguem mínimos para as duas experiências aprovadas', () => {
  assert.ok(
    server.includes(
      'items(summary,status,htmlLink,start(date,dateTime,timeZone),end(date,dateTime,timeZone))',
    ),
  );
  for (const forbidden of [
    'description',
    'attendees',
    'location',
    'attachments',
    'conferenceData',
    'items(id,',
  ]) {
    assert.ok(!server.includes(forbidden), `campo proibido encontrado: ${forbidden}`);
  }
});

check('dados não são persistidos nem cacheados', () => {
  assert.ok(server.includes("cache: 'no-store'"));
  assert.ok(!server.includes(".from('"));
  assert.ok(!server.includes('createAdminClient'));
});

check('401/403 exigem reconexão em vez de simular agenda vazia', () => {
  assert.ok(server.includes('response.status === 401 || response.status === 403'));
  assert.ok(server.includes("status: 'permissions'"));
  assert.ok(ui.includes('Reconecte o Google Calendar'));
});

check('UI oferece acesso ao evento e ao Google Calendar sem criar segunda fonte de verdade', () => {
  assert.ok(ui.includes('event.htmlLink'));
  assert.ok(ui.includes('https://calendar.google.com/calendar/u/0/r'));
  assert.ok(!ui.includes('localStorage'));
  assert.ok(!ui.includes('sessionStorage'));
});

check('leitura conversacional usa janela explícita e limite controlado', () => {
  assert.ok(server.includes('export async function getGoogleCalendarEventsInWindow'));
  assert.ok(server.includes("url.searchParams.set('timeMin', input.timeMin)"));
  assert.ok(server.includes("url.searchParams.set('timeMax', input.timeMax)"));
  assert.ok(server.includes('Math.min(Math.max(value, 1), 10)'));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
