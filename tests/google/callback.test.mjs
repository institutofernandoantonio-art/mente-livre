// Auditoria estática de src/app/conectar-google-calendar/callback/route.ts
// — correção de reconexão via RPC (private.reconnect_google_calendar,
// exposta por public.reconnect_google_calendar).
//
// Execução: npm run test:calendar-callback
//
// Por que auditoria estática: o arquivo usa `next/headers`/`next/navigation`
// e `@/lib/supabase/server` — mesmo padrão já usado em toda `src/app/` que
// depende do runtime do Next.js (ver tests/tarefas/tasks-actions.test.mjs).
// O comportamento dinâmico real (a RPC efetivamente evita 23505 e nunca
// expõe o token) é coberto pela auditoria estrutural da migration
// (tests/google/reconnect-migration.test.mjs) + pela garantia do próprio
// Postgres para `ON CONFLICT ... DO UPDATE` — nunca reimplementado aqui.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(
  new URL('../../src/app/conectar-google-calendar/callback/route.ts', import.meta.url),
);
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

// ============================================================================
// 1-4. RPC substitui insert/upsert direto — primeira conexão E reconexão
// funcionam, sem tocar a tabela diretamente
// ============================================================================

check('1. usa supabase.rpc(\'reconnect_google_calendar\', ...) — zero insert/upsert direto', () => {
  assert.ok(codeOnly.includes(".rpc('reconnect_google_calendar'"), 'chamada RPC não encontrada');
  assert.ok(!codeOnly.includes('.insert('), 'insert direto não deveria mais existir neste arquivo');
  assert.ok(!codeOnly.includes('.upsert('), 'upsert direto não deveria mais existir neste arquivo');
});

check('2. zero .from(\'google_calendar_connections\') — este arquivo não toca mais a tabela diretamente', () => {
  assert.ok(!codeOnly.includes("from('google_calendar_connections')"));
});

check('3. payload da RPC contém EXATAMENTE p_refresh_token — user_id nunca é enviado pelo client', () => {
  const match = codeOnly.match(/\.rpc\('reconnect_google_calendar',\s*\{([^}]*)\}/s);
  assert.ok(match, 'payload da RPC não encontrado');
  const payload = match[1];
  assert.ok(payload.includes('p_refresh_token: refreshToken'));
  assert.ok(!/user_id|userId/.test(payload), 'user_id nunca deve ser enviado como parâmetro da RPC');
  const keys = payload.match(/(\w+):/g) ?? [];
  assert.equal(keys.length, 1, 'payload deve ter exatamente 1 chave (p_refresh_token)');
});

check('4. exatamente 1 chamada .rpc( em todo o arquivo (zero segunda query)', () => {
  const occurrences = codeOnly.split('.rpc(').length - 1;
  assert.equal(occurrences, 1);
});

// ============================================================================
// 5-6. Zero admin/service-role introduzido; zero delete
// ============================================================================

check('5. continua usando createClient() normal — zero admin/service_role/createAdminClient', () => {
  assert.ok(codeOnly.includes("from '@/lib/supabase/server'"));
  assert.ok(codeOnly.includes('await createClient()'));
  const forbidden = ['createAdminClient', 'service_role', 'SUPABASE_SECRET_KEY', 'admin'];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('6. zero .delete( encadeado em .from( — nada na tabela é apagado por este arquivo', () => {
  // `.delete(` sozinho daria falso positivo em `cookieStore.delete(...)`
  // (exclusão do cookie de state, sempre existiu, nada a ver com banco) —
  // a checagem real é especificamente por um DELETE do Supabase.
  assert.ok(!/\.from\([^)]*\)\s*\.delete\(/.test(codeOnly));
});

// ============================================================================
// 7-9. Mecânica OAuth/CSRF/redirect_uri preservada, intocada por esta correção
// ============================================================================

check('7. validação de code/state/storedState continua idêntica', () => {
  assert.ok(codeOnly.includes('!code || !state || !storedState || state !== storedState'));
});

check('8. redirect_uri continua derivado de url.origin (nunca hardcoded)', () => {
  assert.ok(codeOnly.includes('const redirectUri = `${url.origin}/conectar-google-calendar/callback`'));
});

check('9. resultado final continua ?calendar=connected/?calendar=error, nada novo', () => {
  assert.ok(codeOnly.includes("redirect('/entrada?calendar=connected')"));
  const errorOccurrences = codeOnly.split("redirect('/entrada?calendar=error')").length - 1;
  assert.ok(errorOccurrences >= 1);
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
