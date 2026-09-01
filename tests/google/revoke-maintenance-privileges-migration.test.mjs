// Auditoria estática da migration
// 20260831040000_revoke_unused_maintenance_privileges_authenticated.sql
// — hardening global de least privilege: revoga TRUNCATE/REFERENCES/
// TRIGGER/MAINTAIN de `authenticated` nas 5 tabelas da aplicação (objetos
// existentes) e corrige o default ACL do role `postgres` em `public`
// (objetos futuros), sem tocar em SELECT/INSERT/UPDATE/DELETE, RLS,
// service_role/anon, ou nas RPCs de reconexão do Google Calendar.
//
// Execução: npm run test:calendar-revoke-maintenance-privileges

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(
  new URL(
    '../../supabase/migrations/20260831040000_revoke_unused_maintenance_privileges_authenticated.sql',
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, 'utf8');
const migrationCodeOnly = migration
  .split('\n')
  .map((line) => line.replace(/^\s*--.*$/, ''))
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

const APP_TABLES = [
  'public.brain_dumps',
  'public.conversation_runtime_states',
  'public.google_calendar_connections',
  'public.items',
  'public.profiles',
];

// ============================================================================
// 1-3. Parte A — revoga dos objetos existentes, exatamente as 5 tabelas
// ============================================================================

check('1. revoga truncate, references, trigger, maintain (exatamente esses 4) de authenticated', () => {
  const match = migrationCodeOnly.match(/revoke ([\w, ]+)\s*\non table/);
  assert.ok(match, 'REVOKE de objetos existentes não encontrado');
  const privileges = match[1].split(',').map((p) => p.trim()).filter(Boolean);
  assert.deepEqual(
    privileges.sort(),
    ['maintain', 'references', 'trigger', 'truncate'].sort(),
  );
});

check('2. lista explicitamente as 5 tabelas da aplicação — nunca ALL TABLES IN SCHEMA', () => {
  assert.ok(!/all tables in schema/i.test(migrationCodeOnly));
  for (const table of APP_TABLES) {
    assert.ok(migrationCodeOnly.includes(table), `tabela ausente do REVOKE: ${table}`);
  }
});

check('3. REVOKE de objetos existentes é de authenticated — nunca anon/service_role/postgres', () => {
  const match = migrationCodeOnly.match(/revoke truncate, references, trigger, maintain[\s\S]*?from (\w+);/);
  assert.ok(match, 'cláusula FROM do REVOKE de objetos existentes não encontrada');
  assert.equal(match[1], 'authenticated');
});

// ============================================================================
// 4-5. Parte B — default ACL corrigido para objetos futuros
// ============================================================================

check('4. ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public presente, revogando os mesmos 4 privilégios', () => {
  assert.ok(migrationCodeOnly.includes('alter default privileges for role postgres in schema public'));
  const match = migrationCodeOnly.match(/alter default privileges for role postgres in schema public\s*\n\s*revoke ([\w, ]+)\s*\n\s*on tables\s*\n\s*from (\w+);/);
  assert.ok(match, 'cláusula REVOKE do ALTER DEFAULT PRIVILEGES não encontrada no formato esperado');
  const privileges = match[1].split(',').map((p) => p.trim()).filter(Boolean);
  assert.deepEqual(privileges.sort(), ['maintain', 'references', 'trigger', 'truncate'].sort());
  assert.equal(match[2], 'authenticated');
});

check('5. default ACL é corrigido só para o schema public — nunca para todo o banco', () => {
  const occurrences = migrationCodeOnly.split('alter default privileges').length - 1;
  assert.equal(occurrences, 1, 'deve haver exatamente 1 ALTER DEFAULT PRIVILEGES');
});

// ============================================================================
// 6-9. Nada mais é tocado — funcional, RLS, outros roles, RPCs de Calendar
// ============================================================================

check('6. zero menção a select/insert/update/delete sendo revogado — privilégios funcionais intocados', () => {
  assert.ok(!/revoke[^;]*\b(select|insert|update|delete)\b[^;]*from authenticated/i.test(migrationCodeOnly));
});

check('7. zero RLS tocada — nenhum create/alter/drop policy, nenhum enable/disable row level security', () => {
  const forbidden = ['create policy', 'drop policy', 'alter policy', 'row level security'];
  for (const token of forbidden) {
    assert.ok(!migrationCodeOnly.toLowerCase().includes(token), `token proibido encontrado: ${token}`);
  }
});

check('8. anon e service_role nunca são alvo de nenhum REVOKE/GRANT nesta migration', () => {
  assert.ok(!/from anon\b/.test(migrationCodeOnly));
  assert.ok(!/from service_role\b/.test(migrationCodeOnly));
  assert.ok(!/to anon\b/.test(migrationCodeOnly));
  assert.ok(!/to service_role\b/.test(migrationCodeOnly));
});

check('9. RPCs de reconexão do Google Calendar não são mencionadas/tocadas', () => {
  assert.ok(!migrationCodeOnly.includes('reconnect_google_calendar'));
  assert.ok(!migrationCodeOnly.includes('private.'));
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
