// Auditoria estática da migration
// 20260831020000_allow_google_calendar_connection_reconnect.sql +
// reafirmação de invariantes da migration original de
// google_calendar_connections (20260824000125) que esta correção nunca
// deveria alterar.
//
// Execução: npm run test:calendar-reconnect-migration
//
// Por que auditoria estática: migrations SQL não são executáveis pelo
// Node — a única forma de provar sua estrutura sem aplicá-las (NÃO
// autorizado nesta subfase) é ler o arquivo-fonte real, mesmo padrão já
// usado para todo `.ts`/`.tsx` neste projeto que não pode ser testado
// dinamicamente sem infraestrutura nova.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(
  new URL(
    '../../supabase/migrations/20260831020000_allow_google_calendar_connection_reconnect.sql',
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

const configPath = fileURLToPath(new URL('../../supabase/config.toml', import.meta.url));
const config = readFileSync(configPath, 'utf8');

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
// 1-2. Schema `private` existe e não é exposto pela Data API
// ============================================================================

check('1. migration cria o schema private (create schema if not exists private)', () => {
  assert.ok(/create schema if not exists private/.test(migrationCodeOnly));
});

check('2. supabase/config.toml não lista "private" em api.schemas — nunca exposto via Data API/PostgREST', () => {
  const match = config.match(/^schemas\s*=\s*\[([^\]]*)\]/m);
  assert.ok(match, 'linha `schemas = [...]` do [api] não encontrada em config.toml');
  const schemas = match[1].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  assert.ok(!schemas.includes('private'), `private não deveria estar em api.schemas: ${schemas.join(', ')}`);
});

// ============================================================================
// 3-6. Função privilegiada (private.reconnect_google_calendar)
// ============================================================================

check('3. private.reconnect_google_calendar é security definer com search_path fixo em \'\'', () => {
  const match = migrationCodeOnly.match(
    /create or replace function private\.reconnect_google_calendar\(p_refresh_token text\)[\s\S]*?\$\$;/,
  );
  assert.ok(match, 'função privada não encontrada');
  const body = match[0];
  assert.ok(/security definer/.test(body));
  assert.ok(/set search_path = ''/.test(body));
});

check('4. private.reconnect_google_calendar recebe SOMENTE p_refresh_token — user_id nunca é parâmetro', () => {
  assert.ok(
    /create or replace function private\.reconnect_google_calendar\(p_refresh_token text\)/.test(
      migrationCodeOnly,
    ),
  );
  assert.ok(!/reconnect_google_calendar\([^)]*user_id/i.test(migrationCodeOnly));
});

check('5. private.reconnect_google_calendar deriva o usuário só de auth.uid() e rejeita nulo/token vazio', () => {
  assert.ok(migrationCodeOnly.includes('v_user_id uuid := auth.uid()'));
  assert.ok(/if v_user_id is null then/.test(migrationCodeOnly));
  assert.ok(/if p_refresh_token is null or length\(trim\(p_refresh_token\)\) = 0 then/.test(migrationCodeOnly));
});

check('6. private.reconnect_google_calendar faz INSERT ... ON CONFLICT (user_id) DO UPDATE atomicamente', () => {
  assert.ok(migrationCodeOnly.includes('insert into public.google_calendar_connections (user_id, refresh_token)'));
  assert.ok(migrationCodeOnly.includes('on conflict (user_id) do update set refresh_token = excluded.refresh_token'));
});

// ============================================================================
// 7-8. Wrapper público (public.reconnect_google_calendar) — fino, invoker
// ============================================================================

check('7. public.reconnect_google_calendar é security invoker (não definer) e só repassa a chamada', () => {
  const match = migrationCodeOnly.match(
    /create or replace function public\.reconnect_google_calendar\(p_refresh_token text\)[\s\S]*?\$\$;/,
  );
  assert.ok(match, 'wrapper público não encontrado');
  const body = match[0];
  assert.ok(/security invoker/.test(body));
  assert.ok(!/security definer/.test(body));
  assert.ok(body.includes('perform private.reconnect_google_calendar(p_refresh_token)'));
});

check('8. wrapper público não retorna dados sensíveis — returns void, nenhum select/return query', () => {
  const match = migrationCodeOnly.match(
    /create or replace function public\.reconnect_google_calendar\(p_refresh_token text\)\s*\nreturns (\w+)/,
  );
  assert.ok(match, 'returns do wrapper não encontrado');
  assert.equal(match[1], 'void');
});

// ============================================================================
// 9-11. Privilégios — mínimo necessário, nada a mais
// ============================================================================

check('9. authenticated recebe EXECUTE nas duas funções; anon/public nunca recebem EXECUTE', () => {
  assert.ok(migrationCodeOnly.includes('grant execute on function private.reconnect_google_calendar(text) to authenticated'));
  assert.ok(migrationCodeOnly.includes('grant execute on function public.reconnect_google_calendar(text) to authenticated'));
  assert.ok(migrationCodeOnly.includes('revoke all on function private.reconnect_google_calendar(text) from public'));
  assert.ok(migrationCodeOnly.includes('revoke all on function public.reconnect_google_calendar(text) from public'));
  assert.ok(!/grant execute[^;]*to anon/.test(migrationCodeOnly));
});

check('10. zero GRANT novo de SELECT/UPDATE/DELETE em google_calendar_connections para authenticated/anon', () => {
  assert.ok(!/grant (select|update|delete)[^;]*on (public\.)?google_calendar_connections/i.test(migrationCodeOnly));
});

check('11. zero service_role/admin nesta migration', () => {
  const forbidden = ['service_role', 'SUPABASE_SECRET_KEY'];
  for (const token of forbidden) {
    assert.ok(!migrationCodeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

// ============================================================================
// 12-13. Invariantes da migration ORIGINAL reafirmadas — nunca tocadas aqui
// ============================================================================

check('12. UNIQUE(user_id) da tabela original continua intacto — no máximo 1 linha por usuário', () => {
  assert.ok(originalMigration.includes('user_id uuid not null unique references auth.users(id)'));
});

check('13. RLS da tabela original continua habilitada (não é reabilitada/desabilitada nesta migration)', () => {
  assert.ok(originalMigration.includes('enable row level security'));
  assert.ok(!migrationCodeOnly.includes('disable row level security'));
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
