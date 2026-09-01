// Auditoria estática da migration
// 20260901100000_create_calendar_event_executions.sql — Subfase 3 da
// criação de compromissos no Google Calendar (idempotência/claim atômico).
//
// Execução: npm run test:calendar-event-executions-migration
//
// Por que auditoria estática: migrations SQL não são executáveis pelo
// Node — a única forma de provar sua estrutura sem aplicá-las (NÃO
// autorizado nesta subfase) é ler o arquivo-fonte real, mesmo padrão já
// usado para as migrations anteriores de Calendar (ver
// tests/google/reconnect-migration.test.mjs). Isto prova a ESTRUTURA do
// SQL — nunca o comportamento transacional real, que só uma aplicação
// remota + banco real poderiam provar.
//
// CORREÇÃO DESTA SUBFASE (lifecycle revisado): o claim NÃO apaga mais
// `conversation_runtime_states`, e a assinatura da função perdeu `p_now`
// (expiração agora usa now() do próprio Postgres). Os testes antigos que
// afirmavam "runtime consumida por DELETE" foram removidos/invertidos —
// nenhuma alegação de que confirm-vs-cancel está completamente
// linearizado permanece neste arquivo (ver relatório desta subfase: essa
// garantia depende de um cancelamento específico ainda não implementado).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(
  new URL('../../supabase/migrations/20260901100000_create_calendar_event_executions.sql', import.meta.url),
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

// ============================================================================
// Tabela calendar_event_executions — shape mínimo, inalterado nesta correção
// ============================================================================

check('proposal_id é a PRIMARY KEY da tabela', () => {
  assert.ok(/create table public\.calendar_event_executions \(\s*\n\s*proposal_id uuid primary key/.test(migrationCodeOnly));
});

check('user_id é FK para auth.users com on delete cascade', () => {
  assert.ok(migrationCodeOnly.includes('user_id uuid not null references auth.users(id) on delete cascade'));
});

check('google_event_id é text not null UNIQUE', () => {
  assert.ok(migrationCodeOnly.includes('google_event_id text not null unique'));
});

check('exatamente as 5 colunas esperadas — nenhum campo novo (runtime_state_id/título/descrição/start/end/timezone/reminder/status/token)', () => {
  const tableMatch = migrationCodeOnly.match(/create table public\.calendar_event_executions \(([\s\S]*?)\n\);/);
  assert.ok(tableMatch, 'definição da tabela não encontrada');
  const columns = tableMatch[1].toLowerCase();
  // `\b` (limite de palavra) é necessário — sem isso, "end" bateria como
  // falso positivo dentro do próprio nome da tabela ("calENDar_event...").
  const forbidden = [
    'title',
    'description',
    'start',
    'end',
    'timezone',
    'reminder',
    'access_token',
    'refresh_token',
    'summary',
    'runtime_state_id',
    'status',
  ];
  for (const token of forbidden) {
    assert.ok(!new RegExp(`\\b${token}\\b`).test(columns), `coluna proibida encontrada: ${token}`);
  }
});

check('RLS habilitada na tabela', () => {
  assert.ok(migrationCodeOnly.includes('alter table public.calendar_event_executions enable row level security'));
});

check(
  '24. sem GRANT de SELECT/INSERT/UPDATE/DELETE direto para authenticated/anon na tabela (revoke explícito presente)',
  () => {
    assert.ok(
      !/grant (select|insert|update|delete)[^;]*on public\.calendar_event_executions/i.test(migrationCodeOnly),
    );
    assert.ok(migrationCodeOnly.includes('revoke all on public.calendar_event_executions from authenticated, anon'));
  },
);

check('sem GRANT de UPDATE/DELETE em lugar nenhum desta migration', () => {
  assert.ok(!/grant update/i.test(migrationCodeOnly));
  assert.ok(!/grant delete/i.test(migrationCodeOnly));
});

check('nenhum ALTER DEFAULT PRIVILEGES reabrindo TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (hardening preservado)', () => {
  assert.ok(!migrationCodeOnly.includes('alter default privileges'));
  assert.ok(!/grant (truncate|references|trigger|maintain)/i.test(migrationCodeOnly));
});

check('CHECK estrutural do formato do google_event_id (charset+comprimento via regex)', () => {
  assert.ok(migrationCodeOnly.includes("check (google_event_id ~ '^[0-9a-f]{32}$')"));
});

// ============================================================================
// Assinatura da função — SEM p_now (correção desta subfase)
// ============================================================================

check('1. função privada NÃO aceita p_now — assinatura é (p_expected_state_id uuid, p_proposal_id uuid)', () => {
  const signatureMatch = migrationCodeOnly.match(
    /create or replace function private\.claim_calendar_event_execution\(([\s\S]*?)\)\s*\nreturns/,
  );
  assert.ok(signatureMatch, 'assinatura da função privada não encontrada');
  const params = signatureMatch[1];
  assert.ok(!/p_now/.test(params), 'p_now não deveria mais existir na assinatura');
  assert.ok(!/user_id/i.test(params));
  assert.ok(!/google_event_id/i.test(params));
  assert.ok(/p_expected_state_id uuid/.test(params));
  assert.ok(/p_proposal_id uuid/.test(params));
  // Exatamente 2 parâmetros — nenhum a mais.
  const paramNames = params.match(/p_\w+/g) ?? [];
  assert.equal(paramNames.length, 2);
});

check('wrapper público também NÃO aceita p_now — mesma assinatura de 2 parâmetros', () => {
  const signatureMatch = migrationCodeOnly.match(
    /create or replace function public\.claim_calendar_event_execution\(([\s\S]*?)\)\s*\nreturns/,
  );
  assert.ok(signatureMatch, 'assinatura do wrapper público não encontrada');
  const params = signatureMatch[1];
  assert.ok(!/p_now/.test(params));
  assert.ok(/p_expected_state_id uuid/.test(params));
  assert.ok(/p_proposal_id uuid/.test(params));
});

check('assinaturas das funções nos GRANT/REVOKE usam (uuid, uuid) — nunca (uuid, timestamptz, uuid)', () => {
  assert.ok(migrationCodeOnly.includes('function private.claim_calendar_event_execution(uuid, uuid)'));
  assert.ok(migrationCodeOnly.includes('function public.claim_calendar_event_execution(uuid, uuid)'));
  assert.ok(!migrationCodeOnly.includes('(uuid, timestamptz, uuid)'));
});

check(
  '3. expiração usa now() do próprio Postgres — nunca p_now do chamador (trust boundary corrigido nesta subfase)',
  () => {
    assert.ok(migrationCodeOnly.includes('and c.expires_at > now()'));
    assert.ok(!migrationCodeOnly.includes('expires_at > p_now'), 'não deveria mais confiar em p_now para expiração');
    // Nenhuma referência a p_now sobrevive em lugar nenhum do arquivo.
    assert.ok(!/\bp_now\b/.test(migrationCodeOnly));
  },
);

// ============================================================================
// Função privada — DEFINER, derivação, ownership
// ============================================================================

check('função privada é SECURITY DEFINER, com search_path fixo em \'\'', () => {
  const match = migrationCodeOnly.match(
    /create or replace function private\.claim_calendar_event_execution\([\s\S]*?\$\$;/,
  );
  assert.ok(match, 'função privada não encontrada');
  const body = match[0];
  assert.ok(/security definer/.test(body));
  assert.ok(/set search_path = ''/.test(body));
});

check('google_event_id é SEMPRE derivado de p_proposal_id — expressão exata lower(replace(...))', () => {
  assert.ok(migrationCodeOnly.includes("v_new_event_id := lower(replace(p_proposal_id::text, '-', ''))"));
});

check('função deriva o usuário só de auth.uid() e rejeita null', () => {
  assert.ok(migrationCodeOnly.includes('v_user_id uuid := auth.uid()'));
  assert.ok(/if v_user_id is null then/.test(migrationCodeOnly));
});

check(
  '15. isolamento por usuário: tanto a checagem de execução já existente quanto a de runtime filtram por user_id = v_user_id — outro usuário nunca obtém claim nem vê o google_event_id de outrem',
  () => {
    assert.ok(/from public\.calendar_event_executions e\s*\n\s*where e\.proposal_id = p_proposal_id\s*\n\s*and e\.user_id = v_user_id/.test(migrationCodeOnly));
    assert.ok(/from public\.conversation_runtime_states c\s*\n\s*where c\.user_id = v_user_id/.test(migrationCodeOnly));
  },
);

check('retorno da função é somente status + google_event_id — nenhum conteúdo de proposta', () => {
  assert.ok(migrationCodeOnly.includes('returns table (status text, google_event_id text)'));
  assert.ok(!/return query select[^;]*v_payload/.test(migrationCodeOnly));
});

// ============================================================================
// 4, 9, 16, 17. Retry idempotente — checa execução ANTES da runtime
// ============================================================================

check(
  'retry idempotente: checa calendar_event_executions ANTES de tocar a runtime row (garante already_claimed mesmo sem runtime viva, e nunca segunda linha)',
  () => {
    const fnBody = migrationCodeOnly.match(
      /create or replace function private\.claim_calendar_event_execution\([\s\S]*?\$\$;/,
    )[0];
    const executionsCheckIndex = fnBody.indexOf('from public.calendar_event_executions');
    const runtimeCheckIndex = fnBody.indexOf('from public.conversation_runtime_states');
    assert.ok(executionsCheckIndex !== -1 && runtimeCheckIndex !== -1, 'uma das duas consultas não foi encontrada');
    assert.ok(executionsCheckIndex < runtimeCheckIndex, 'a checagem de execução já existente deveria vir primeiro');
    assert.ok(fnBody.includes("'already_claimed'::text, v_existing_event_id"));
  },
);

check('claim novo usa FOR UPDATE (mesma técnica de CAS já usada em confirm_create_local_task)', () => {
  assert.ok(/for update;/.test(migrationCodeOnly));
});

// ============================================================================
// 5, 6, 19, 23. CORREÇÃO CENTRAL: claim NUNCA apaga/altera a runtime; NUNCA
// seta completed_at
// ============================================================================

check(
  '5, 6 e 19. função privada NUNCA contém DELETE nem UPDATE em conversation_runtime_states — a ProposalState sobrevive ao claim',
  () => {
    const fnBody = migrationCodeOnly.match(
      /create or replace function private\.claim_calendar_event_execution\([\s\S]*?\$\$;/,
    )[0];
    assert.ok(
      !/delete from public\.conversation_runtime_states/.test(fnBody),
      'claim não deveria mais apagar a runtime',
    );
    assert.ok(
      !/update public\.conversation_runtime_states/.test(fnBody),
      'claim nunca deveria alterar a runtime',
    );
    // A única operação em conversation_runtime_states é o SELECT ... FOR
    // UPDATE (leitura+lock, nunca escrita).
    const runtimeOpMatches = fnBody.match(/(select|insert|update|delete)[^;]*conversation_runtime_states/gis) ?? [];
    for (const op of runtimeOpMatches) {
      assert.ok(/^select/i.test(op.trim()), `operação inesperada em conversation_runtime_states: ${op}`);
    }
  },
);

check('4 e 23. INSERT em calendar_event_executions nunca inclui completed_at (permanece NULL por default no claim)', () => {
  assert.ok(
    migrationCodeOnly.includes(
      'insert into public.calendar_event_executions (proposal_id, user_id, google_event_id)',
    ),
  );
  assert.ok(!/insert into public\.calendar_event_executions \([^)]*completed_at/.test(migrationCodeOnly));
});

check('nenhuma menção a finalize/completed_at sendo escrito nesta migration — finalize é trabalho futuro, não implementado', () => {
  assert.ok(!migrationCodeOnly.includes('finalize_calendar_event_execution'));
  assert.ok(!/completed_at\s*=/.test(migrationCodeOnly));
});

// ============================================================================
// Grants — mínimo necessário, wrapper INVOKER, private nunca exposto
// ============================================================================

check('EXECUTE da função privada: revoke de public, grant só para authenticated', () => {
  assert.ok(migrationCodeOnly.includes('revoke all on function private.claim_calendar_event_execution(uuid, uuid) from public'));
  assert.ok(migrationCodeOnly.includes('grant execute on function private.claim_calendar_event_execution(uuid, uuid) to authenticated'));
});

check('wrapper público é SECURITY INVOKER (não DEFINER) e só repassa a chamada', () => {
  const match = migrationCodeOnly.match(
    /create or replace function public\.claim_calendar_event_execution\([\s\S]*?\$\$;/,
  );
  assert.ok(match, 'wrapper público não encontrado');
  const body = match[0];
  assert.ok(/security invoker/.test(body));
  assert.ok(!/security definer/.test(body));
  assert.ok(body.includes('select * from private.claim_calendar_event_execution(p_expected_state_id, p_proposal_id)'));
});

check('EXECUTE do wrapper público: revoke de public, grant só para authenticated', () => {
  assert.ok(migrationCodeOnly.includes('revoke all on function public.claim_calendar_event_execution(uuid, uuid) from public'));
  assert.ok(migrationCodeOnly.includes('grant execute on function public.claim_calendar_event_execution(uuid, uuid) to authenticated'));
});

check('nenhum GRANT de CREATE no schema private nesta migration', () => {
  assert.ok(!/grant create on schema private/i.test(migrationCodeOnly));
});

check('nenhum re-grant de USAGE em schema private (já concedido em migration anterior) — evita grant redundante/confuso', () => {
  assert.ok(!/grant usage on schema private/.test(migrationCodeOnly));
});

check('zero service_role/admin nesta migration', () => {
  const forbidden = ['service_role', 'SUPABASE_SECRET_KEY', 'createAdminClient'];
  for (const token of forbidden) {
    assert.ok(!migrationCodeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('20. zero menção a events.insert/Calendar write — esta migration nunca chama o Google', () => {
  const forbidden = ['events.insert', 'googleapis.com', 'access_token', 'refresh_token'];
  for (const token of forbidden) {
    assert.ok(!migrationCodeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

// ============================================================================
// Dívida registrada de confirm_create_local_task (mesmo trust boundary,
// não corrigida nesta subfase, por design)
// ============================================================================

check(
  'dívida de confirm_create_local_task (p_now) está DOCUMENTADA nesta migration (em comentário), mas a RPC daquela função não foi tocada aqui',
  () => {
    // Documentada só em COMENTÁRIO (nunca em código real) — por isso lê o
    // arquivo bruto (`migration`), não `migrationCodeOnly` (que apaga
    // comentários de propósito).
    assert.ok(migration.toLowerCase().includes('confirm_create_local_task'));
    // Esta migration NUNCA redefine confirm_create_local_task — a dívida é
    // só registrada em comentário, nunca corrigida aqui.
    assert.ok(!migrationCodeOnly.includes('create or replace function public.confirm_create_local_task'));
  },
);

// ============================================================================
// Base estrutural do argumento de linearização confirm-vs-cancel — NUNCA
// mais afirmado como "completo" nesta subfase (correção pedida)
// ============================================================================

check(
  'nenhuma alegação de que confirm-vs-cancel está COMPLETAMENTE linearizado — o risco de cancelamento concorrente após claim é registrado como pré-requisito futuro, não resolvido aqui',
  () => {
    assert.ok(
      !/completamente linearizad[oa]/i.test(migration),
      'não deveria haver alegação de linearização completa nesta migration',
    );
    // O comentário precisa mencionar explicitamente que isso é um risco
    // registrado, não uma garantia já entregue.
    assert.ok(/CONFIRM VS CANCEL/.test(migration));
    assert.ok(/pré-requisito/.test(migration) || /pre-requisito/.test(migration));
  },
);

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
