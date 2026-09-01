// Auditoria estática da migration
// 20260901130000_add_google_calendar_event_write_capability.sql — Subfase
// 10 da criação de compromissos no Google Calendar (gate seguro para
// conexões antigas freebusy-only).
//
// Execução: npm run test:google-calendar-event-write-capability-migration
//
// Por que auditoria estática: migrations SQL não são executáveis pelo
// Node — a única forma de provar sua estrutura sem aplicá-las (NÃO
// autorizado nesta subfase) é ler o arquivo-fonte real, mesmo padrão já
// usado para todas as migrations anteriores de Calendar. Isto prova a
// ESTRUTURA do SQL — nunca o comportamento transacional real
// (atomicidade/concorrência de verdade), que só uma aplicação remota +
// banco real poderiam provar. Este arquivo jamais finge provar isso.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(
  new URL(
    '../../supabase/migrations/20260901130000_add_google_calendar_event_write_capability.sql',
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, 'utf8');
const migrationCodeOnly = migration
  .split('\n')
  .map((line) => line.replace(/^\s*--.*$/, ''))
  .join('\n');

const oldReconnectMigrationPath = fileURLToPath(
  new URL('../../supabase/migrations/20260831020000_allow_google_calendar_connection_reconnect.sql', import.meta.url),
);
const oldReconnectMigration = readFileSync(oldReconnectMigrationPath, 'utf8');
const oldReconnectCodeOnly = oldReconnectMigration
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

function fnBodyOf(codeOnly, schema, fnName) {
  const match = codeOnly.match(new RegExp(`create or replace function ${schema}\\.${fnName}\\([\\s\\S]*?\\$\\$;`));
  assert.ok(match, `função ${schema}.${fnName} não encontrada`);
  return match[0];
}

// ============================================================================
// 1-4. Coluna event_write_enabled
// ============================================================================

check('0. esta migration é POSTERIOR a todas as anteriores pelo nome do arquivo', () => {
  assert.ok(migrationPath.includes('20260901130000'));
});

check('1. adiciona a coluna event_write_enabled em google_calendar_connections', () => {
  assert.ok(
    migrationCodeOnly.includes(
      'alter table public.google_calendar_connections\n  add column event_write_enabled boolean not null default false;',
    ),
  );
});

check('2. a coluna é boolean', () => {
  assert.ok(/add column event_write_enabled boolean/.test(migrationCodeOnly));
});

check('3. a coluna é NOT NULL', () => {
  assert.ok(/add column event_write_enabled boolean not null/.test(migrationCodeOnly));
});

check('4. o default é false', () => {
  assert.ok(/add column event_write_enabled boolean not null default false/.test(migrationCodeOnly));
});

check(
  '5. nenhuma conexão antiga é atualizada para true pela migration — zero UPDATE direto na tabela (só o `do update set` da nova RPC, que é um upsert condicional dentro de uma função, nunca um backfill em massa)',
  () => {
    // Proíbe um UPDATE "solto" (backfill) na tabela — permite
    // explicitamente o idioma `do update set` do INSERT ... ON CONFLICT,
    // que é a única forma de "update" nesta migration, e só afeta a LINHA
    // que a própria RPC está processando (nunca um UPDATE em massa).
    assert.ok(
      !/(?<!do )update\s+public\.google_calendar_connections\s+set/i.test(migrationCodeOnly),
      'não deveria haver um UPDATE direto (fora do idioma ON CONFLICT DO UPDATE) na tabela',
    );
    // Confirma que a ÚNICA ocorrência do padrão "update ... set" no arquivo
    // é precedida por "do " (o upsert da nova RPC) — nunca um UPDATE solto.
    const updateOccurrences = [...migrationCodeOnly.matchAll(/update\s+(?:public\.google_calendar_connections\s+)?set/gi)];
    for (const occurrence of updateOccurrences) {
      const precedingText = migrationCodeOnly.slice(Math.max(0, occurrence.index - 3), occurrence.index);
      assert.ok(/do\s*$/i.test(precedingText), `UPDATE não precedido por "do" (upsert): "${occurrence[0]}"`);
    }
  },
);

// ============================================================================
// 6-7. RPC antiga (reconnect_google_calendar) continua existindo e NUNCA
// define write=true — provado no arquivo IRMÃO, nunca reescrito aqui
// ============================================================================

check('6. a RPC antiga (reconnect_google_calendar) continua existindo, no arquivo original, intacta', () => {
  assert.ok(oldReconnectCodeOnly.includes('create or replace function private.reconnect_google_calendar('));
  assert.ok(oldReconnectCodeOnly.includes('create or replace function public.reconnect_google_calendar('));
});

check(
  '7. a RPC antiga NUNCA define event_write_enabled = true (nem sequer menciona a coluna) — esta migration não a reescreve',
  () => {
    assert.ok(!oldReconnectCodeOnly.includes('event_write_enabled'));
    // Prova estrutural complementar: a única coluna tocada pelo `do update
    // set` da RPC antiga é refresh_token.
    const oldFnBody = fnBodyOf(oldReconnectCodeOnly, 'private', 'reconnect_google_calendar');
    const doUpdateMatch = oldFnBody.match(/on conflict \(user_id\) do update set ([^;]+);/);
    assert.ok(doUpdateMatch, 'cláusula do update da RPC antiga não encontrada');
    assert.equal(doUpdateMatch[1].trim(), 'refresh_token = excluded.refresh_token');
  },
);

check('esta própria migration nunca redefine a RPC antiga (create or replace ... reconnect_google_calendar sem sufixo)', () => {
  // Garante que "reconnect_google_calendar(" sem o sufixo "_with_event_write"
  // não aparece como definição de função nesta migration.
  assert.ok(!/create or replace function (private|public)\.reconnect_google_calendar\(/.test(migrationCodeOnly));
});

// ============================================================================
// 8-13. Nova RPC — reconnect_google_calendar_with_event_write
// ============================================================================

check('8. a nova função privada é SECURITY DEFINER', () => {
  const body = fnBodyOf(migrationCodeOnly, 'private', 'reconnect_google_calendar_with_event_write');
  assert.ok(/security definer/.test(body));
});

check("9. search_path fixado em '' na função privada", () => {
  const body = fnBodyOf(migrationCodeOnly, 'private', 'reconnect_google_calendar_with_event_write');
  assert.ok(/set search_path = ''/.test(body));
});

check('10. o wrapper público é SECURITY INVOKER (nunca DEFINER)', () => {
  const body = fnBodyOf(migrationCodeOnly, 'public', 'reconnect_google_calendar_with_event_write');
  assert.ok(/security invoker/.test(body));
  assert.ok(!/security definer/.test(body));
  assert.ok(body.includes('perform private.reconnect_google_calendar_with_event_write(p_refresh_token)'));
});

check('11. auth.uid() obrigatório — deriva o usuário e rejeita null', () => {
  const body = fnBodyOf(migrationCodeOnly, 'private', 'reconnect_google_calendar_with_event_write');
  assert.ok(body.includes('v_user_id uuid := auth.uid()'));
  assert.ok(/if v_user_id is null then/.test(body));
});

check('12. zero user_id como argumento em qualquer uma das duas funções — só p_refresh_token', () => {
  const privateSignature = migrationCodeOnly.match(
    /create or replace function private\.reconnect_google_calendar_with_event_write\(([\s\S]*?)\)\s*\nreturns/,
  );
  const publicSignature = migrationCodeOnly.match(
    /create or replace function public\.reconnect_google_calendar_with_event_write\(([\s\S]*?)\)\s*\nreturns/,
  );
  assert.ok(privateSignature && publicSignature);
  for (const sig of [privateSignature[1], publicSignature[1]]) {
    assert.ok(!/user_id/i.test(sig));
    const paramNames = sig.match(/p_\w+/g) ?? [];
    assert.deepEqual(paramNames, ['p_refresh_token']);
  }
});

check('13. a nova RPC define event_write_enabled = true (no INSERT e no ON CONFLICT DO UPDATE)', () => {
  const body = fnBodyOf(migrationCodeOnly, 'private', 'reconnect_google_calendar_with_event_write');
  assert.ok(body.includes('values (v_user_id, p_refresh_token, true)'));
  assert.ok(/event_write_enabled = true/.test(body));
});

check('14. refresh_token e a flag são atualizados na MESMA instrução (atômico) — um único INSERT ... ON CONFLICT DO UPDATE', () => {
  const body = fnBodyOf(migrationCodeOnly, 'private', 'reconnect_google_calendar_with_event_write');
  const insertCount = (body.match(/insert into public\.google_calendar_connections/g) ?? []).length;
  assert.equal(insertCount, 1, 'deveria haver exatamente 1 INSERT (nunca duas operações separadas)');
  const doUpdateMatch = body.match(/on conflict \(user_id\) do update\s*\n\s*set ([\s\S]*?);/);
  assert.ok(doUpdateMatch, 'cláusula do update não encontrada');
  assert.ok(doUpdateMatch[1].includes('refresh_token = excluded.refresh_token'));
  assert.ok(doUpdateMatch[1].includes('event_write_enabled = true'));
});

// ============================================================================
// 15-17. Grants — zero SELECT/UPDATE direto na tabela, PUBLIC/anon sem
// EXECUTE, authenticated só com o EXECUTE aprovado
// ============================================================================

check('15. zero grant direto de SELECT/UPDATE/INSERT/DELETE na tabela para authenticated/anon nesta migration', () => {
  assert.ok(!/grant (select|update|insert|delete)[^;]*on public\.google_calendar_connections/i.test(migrationCodeOnly));
});

check('16. PUBLIC/anon sem EXECUTE em nenhuma das 2 novas funções', () => {
  assert.ok(
    migrationCodeOnly.includes(
      'revoke all on function private.reconnect_google_calendar_with_event_write(text) from public',
    ),
  );
  assert.ok(
    migrationCodeOnly.includes(
      'revoke all on function public.reconnect_google_calendar_with_event_write(text) from public',
    ),
  );
  assert.ok(!/grant execute[^;]*to anon/i.test(migrationCodeOnly));
});

check('17. authenticated recebe EXECUTE só nas 2 novas funções (nenhum outro grant novo)', () => {
  assert.ok(
    migrationCodeOnly.includes(
      'grant execute on function private.reconnect_google_calendar_with_event_write(text) to authenticated',
    ),
  );
  assert.ok(
    migrationCodeOnly.includes(
      'grant execute on function public.reconnect_google_calendar_with_event_write(text) to authenticated',
    ),
  );
});

// ============================================================================
// Segurança geral — zero admin/service-role, zero token
// ============================================================================

check('zero service_role/admin nesta migration', () => {
  const forbidden = ['service_role', 'SUPABASE_SECRET_KEY', 'createAdminClient'];
  for (const token of forbidden) {
    assert.ok(!migrationCodeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

check(
  '"access_token" só aparece em prosa documentando sua AUSÊNCIA (comentários/COMMENT ON COLUMN) — nunca como coluna/parâmetro real',
  () => {
    // access_token é mencionado no comentário de cabeçalho e no `comment on
    // column` só para DOCUMENTAR que esta coluna nunca guarda isso — nunca
    // como um nome de coluna/parâmetro real. Prova estrutural: nenhuma
    // definição de coluna ("add column ... access_token") nem parâmetro
    // ("p_access_token") existe.
    assert.ok(!/add column\s+\w*access_token/i.test(migrationCodeOnly));
    assert.ok(!migrationCodeOnly.includes('p_access_token'));
  },
);

check('nenhuma tabela nova é criada (zero "create table" nesta migration)', () => {
  assert.ok(!/create table/i.test(migrationCodeOnly));
});

check('nenhuma lista de scopes/access_token/resposta OAuth é armazenada — só a coluna booleana', () => {
  assert.ok(!/add column.*scope/i.test(migrationCodeOnly));
  assert.ok(!/add column.*token/i.test(migrationCodeOnly));
  const addColumnCount = (migrationCodeOnly.match(/add column/g) ?? []).length;
  assert.equal(addColumnCount, 1, 'deveria haver exatamente 1 ADD COLUMN nesta migration');
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
