// Auditoria estática da migration
// 20260831030000_revoke_unused_default_grants_google_calendar_connections.sql
// — remove REFERENCES/TRIGGER/TRUNCATE de `authenticated` em
// google_calendar_connections (default privilege do Postgres nunca
// concedida por nenhuma migration deste repositório, nunca usada por
// nenhum fluxo real — ver comentário da própria migration).
//
// Execução: npm run test:calendar-revoke-unused-grants

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(
  new URL(
    '../../supabase/migrations/20260831030000_revoke_unused_default_grants_google_calendar_connections.sql',
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, 'utf8');
const migrationCodeOnly = migration
  .split('\n')
  .map((line) => line.replace(/^\s*--.*$/, ''))
  .join('\n');

const originalMigrationPath = fileURLToPath(
  new URL('../../supabase/migrations/20260824000125_create_google_calendar_connections.sql', import.meta.url),
);
const originalMigration = readFileSync(originalMigrationPath, 'utf8');

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

check('1. revoga exatamente references, trigger, truncate de authenticated em google_calendar_connections', () => {
  assert.ok(
    /revoke references,\s*trigger,\s*truncate\s*\non public\.google_calendar_connections\s*\nfrom authenticated;/.test(
      migrationCodeOnly,
    ),
  );
});

check('2. não revoga INSERT — única operação direta que a aplicação preserva', () => {
  assert.ok(!/revoke[^;]*insert[^;]*from authenticated/i.test(migrationCodeOnly));
});

check('3. não toca select/update/delete nesta migration', () => {
  assert.ok(!/revoke[^;]*(select|update|delete)[^;]*from authenticated/i.test(migrationCodeOnly));
});

check('4. não altera service_role nem postgres', () => {
  assert.ok(!migrationCodeOnly.includes('service_role'));
  assert.ok(!/from postgres\b/.test(migrationCodeOnly));
});

check('5. não altera anon (já zerado desde a migration original)', () => {
  assert.ok(!migrationCodeOnly.includes('anon'));
});

check('6. migration original ainda concede INSERT a authenticated — invariante preservado', () => {
  assert.ok(originalMigration.includes('grant insert'));
  assert.ok(originalMigration.includes('to authenticated'));
});

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
