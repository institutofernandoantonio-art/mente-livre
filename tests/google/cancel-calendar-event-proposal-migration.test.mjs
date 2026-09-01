// Auditoria estática da migration
// 20260901120000_add_cancel_calendar_event_proposal.sql — Subfase 5 da
// criação de compromissos no Google Calendar (cancelamento protegido de
// proposta de evento).
//
// Execução: npm run test:cancel-calendar-event-proposal-migration
//
// Por que auditoria estática: migrations SQL não são executáveis pelo
// Node — a única forma de provar sua estrutura sem aplicá-las (NÃO
// autorizado nesta subfase) é ler o arquivo-fonte real, mesmo padrão já
// usado para claim/finalize (ver
// tests/google/calendar-event-executions-migration.test.mjs/
// tests/google/finalize-calendar-event-execution-migration.test.mjs).
// Isto prova a ESTRUTURA do SQL — nunca o comportamento transacional real
// (atomicidade/concorrência de verdade entre chamadas simultâneas), que
// só uma aplicação remota + banco real poderiam provar. Este arquivo
// jamais finge provar isso.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(
  new URL('../../supabase/migrations/20260901120000_add_cancel_calendar_event_proposal.sql', import.meta.url),
);
const migration = readFileSync(migrationPath, 'utf8');
const migrationCodeOnly = migration
  .split('\n')
  .map((line) => line.replace(/^\s*--.*$/, ''))
  .join('\n');

const claimMigrationPath = fileURLToPath(
  new URL('../../supabase/migrations/20260901100000_create_calendar_event_executions.sql', import.meta.url),
);
const claimMigration = readFileSync(claimMigrationPath, 'utf8');

const finalizeMigrationPath = fileURLToPath(
  new URL('../../supabase/migrations/20260901110000_add_finalize_calendar_event_execution.sql', import.meta.url),
);
const finalizeMigration = readFileSync(finalizeMigrationPath, 'utf8');

function stripComments(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*--.*$/, ''))
    .join('\n');
}

const claimCodeOnly = stripComments(claimMigration);
const finalizeCodeOnly = stripComments(finalizeMigration);

function fnBodyFrom(codeOnly, schema, fnName) {
  const match = codeOnly.match(new RegExp(`create or replace function ${schema}\\.${fnName}\\([\\s\\S]*?\\$\\$;`));
  assert.ok(match, `função ${schema}.${fnName} não encontrada`);
  return match[0];
}

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

function fnBodyOf(schema) {
  const match = migrationCodeOnly.match(
    new RegExp(`create or replace function ${schema}\\.cancel_calendar_event_proposal\\([\\s\\S]*?\\$\\$;`),
  );
  assert.ok(match, `função ${schema}.cancel_calendar_event_proposal não encontrada`);
  return match[0];
}

// ============================================================================
// Migrations anteriores (claim/finalize) NUNCA foram reescritas
// ============================================================================

check('0a. esta migration é POSTERIOR a 20260901100000/20260901110000 pelo nome do arquivo', () => {
  assert.ok(migrationPath.includes('20260901120000'));
});

check('0b. claim (20260901100000) e finalize (20260901110000) permanecem intactas — esta migration nunca as redefine', () => {
  assert.ok(!migrationCodeOnly.includes('create or replace function private.claim_calendar_event_execution'));
  assert.ok(!migrationCodeOnly.includes('create or replace function public.claim_calendar_event_execution'));
  assert.ok(!migrationCodeOnly.includes('create or replace function private.finalize_calendar_event_execution'));
  assert.ok(!migrationCodeOnly.includes('create or replace function public.finalize_calendar_event_execution'));
  assert.ok(!migrationCodeOnly.includes('create table public.calendar_event_executions'));
  assert.ok(!/alter table public\.calendar_event_executions/i.test(migrationCodeOnly));
  assert.ok(!/alter table public\.conversation_runtime_states/i.test(migrationCodeOnly));
});

check('0c. claim/finalize (arquivos irmãos) não ganharam menção a cancel_calendar_event_proposal por engano', () => {
  assert.ok(!claimMigration.includes('cancel_calendar_event_proposal'));
  assert.ok(!finalizeMigration.includes('cancel_calendar_event_proposal'));
});

// ============================================================================
// 4, 5, 6, 7. Assinatura — sem p_now/user_id/google_event_id/token/payload
// ============================================================================

check('1. função privada tem exatamente 2 parâmetros: p_expected_state_id uuid, p_proposal_id uuid', () => {
  const signatureMatch = migrationCodeOnly.match(
    /create or replace function private\.cancel_calendar_event_proposal\(([\s\S]*?)\)\s*\nreturns/,
  );
  assert.ok(signatureMatch, 'assinatura da função privada não encontrada');
  const params = signatureMatch[1];
  assert.ok(/p_expected_state_id uuid/.test(params));
  assert.ok(/p_proposal_id uuid/.test(params));
  const paramNames = params.match(/p_\w+/g) ?? [];
  assert.equal(paramNames.length, 2);
});

check('2. wrapper público tem a mesma assinatura de 2 parâmetros', () => {
  const signatureMatch = migrationCodeOnly.match(
    /create or replace function public\.cancel_calendar_event_proposal\(([\s\S]*?)\)\s*\nreturns/,
  );
  assert.ok(signatureMatch, 'assinatura do wrapper público não encontrada');
  const params = signatureMatch[1];
  assert.ok(/p_expected_state_id uuid/.test(params));
  assert.ok(/p_proposal_id uuid/.test(params));
  const paramNames = params.match(/p_\w+/g) ?? [];
  assert.equal(paramNames.length, 2);
});

check('5, 6 e 7. zero p_now/user_id/google_event_id/token/payload como parâmetro real', () => {
  const forbidden = [
    'p_now',
    'p_user_id',
    'p_google_event_id',
    'p_payload',
    'p_token',
    'p_access_token',
    'p_refresh_token',
  ];
  for (const token of forbidden) {
    assert.ok(!migrationCodeOnly.includes(token), `parâmetro proibido encontrado: ${token}`);
  }
});

check('assinaturas nos GRANT/REVOKE usam (uuid, uuid)', () => {
  assert.ok(migrationCodeOnly.includes('function private.cancel_calendar_event_proposal(uuid, uuid)'));
  assert.ok(migrationCodeOnly.includes('function public.cancel_calendar_event_proposal(uuid, uuid)'));
});

// ============================================================================
// Retorno — só status, os 3 valores exatos, nenhum id/conteúdo
// ============================================================================

check('retorno é `returns table (status text)` — nenhuma coluna extra (sem id/conteúdo da proposta)', () => {
  const privateBody = fnBodyOf('private');
  const publicBody = fnBodyOf('public');
  assert.ok(/returns table \(status text\)/.test(privateBody));
  assert.ok(/returns table \(status text\)/.test(publicBody));
  assert.ok(!privateBody.includes('google_event_id'));
});

check('os únicos 3 status retornados são cancelled/execution_started/conflict — nenhum quarto valor', () => {
  const privateBody = fnBodyOf('private');
  const statusLiterals = [...privateBody.matchAll(/select '([a-z_]+)'::text/g)].map((m) => m[1]);
  assert.ok(statusLiterals.length > 0, 'nenhum status literal encontrado');
  const allowed = new Set(['cancelled', 'execution_started', 'conflict']);
  for (const status of statusLiterals) {
    assert.ok(allowed.has(status), `status inesperado encontrado: ${status}`);
  }
  for (const status of allowed) {
    assert.ok(statusLiterals.includes(status), `status esperado ausente: ${status}`);
  }
});

// ============================================================================
// 4. auth.uid() obrigatório
// ============================================================================

check('4. função deriva o usuário só de auth.uid() e rejeita null', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(privateBody.includes('v_user_id uuid := auth.uid()'));
  assert.ok(/if v_user_id is null then/.test(privateBody));
});

check('nenhuma menção de userId/user_id como parâmetro aceito de fora', () => {
  const signatureMatch = migrationCodeOnly.match(
    /create or replace function private\.cancel_calendar_event_proposal\(([\s\S]*?)\)\s*\nreturns/,
  );
  assert.ok(!/user_id/i.test(signatureMatch[1]));
});

// ============================================================================
// 8. Ordem de locks — RUNTIME antes de EXECUTION
// ============================================================================

check('8. dentro da função privada, o primeiro `for update` é sobre conversation_runtime_states', () => {
  const privateBody = fnBodyOf('private');
  const forUpdateIndexes = [...privateBody.matchAll(/for update/g)].map((m) => m.index);
  assert.ok(forUpdateIndexes.length >= 2, 'esperava pelo menos 2 blocos for update (runtime + execution)');
  const firstForUpdateIndex = forUpdateIndexes[0];
  const runtimeMentionIndex = privateBody.indexOf('conversation_runtime_states');
  const executionMentionIndexBeforeFirstLock = privateBody
    .slice(0, firstForUpdateIndex)
    .indexOf('calendar_event_executions');
  assert.ok(runtimeMentionIndex !== -1 && runtimeMentionIndex < firstForUpdateIndex);
  assert.equal(
    executionMentionIndexBeforeFirstLock,
    -1,
    'calendar_event_executions não deveria ser mencionado antes do primeiro for update (que deve travar RUNTIME)',
  );
});

check('a segunda trava (`for update`) é sobre calendar_event_executions', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(
    /from public\.calendar_event_executions e\s*\n\s*where e\.proposal_id = p_proposal_id\s*\n\s*and e\.user_id = v_user_id\s*\n\s*for update;/.test(
      privateBody,
    ),
  );
});

check(
  'comentário documenta a ordem de locks como idêntica a claim/finalize e conclui compatibilidade (nenhum STOP necessário)',
  () => {
    assert.ok(/ORDEM DE LOCKS/.test(migration));
    assert.ok(/Nenhuma[\s\S]{0,20}incompatibilidade foi encontrada/.test(migration));
  },
);

check('comentário contém a prova explícita dos dois interleavings CLAIM vs CANCEL', () => {
  assert.ok(/PROVA DO RACE CLAIM vs CANCEL/.test(migration));
  assert.ok(/Interleaving 1/.test(migration));
  assert.ok(/Interleaving 2/.test(migration));
  assert.ok(/zero chamada futura ao Google/.test(migration) || /nenhum "cancelado" falso/.test(migration));
});

check('comentário documenta explicitamente a race com finalize', () => {
  assert.ok(/RACE COM FINALIZE/.test(migration));
});

// ============================================================================
// 9, 10, 11, 12. Validações da runtime — kind, proposalId, actionType, TTL
// ============================================================================

check('9. exige state_kind = proposal', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(/c\.state_kind = 'proposal'/.test(privateBody));
});

check('10. exige (payload ->> proposalId) = p_proposal_id::text', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(privateBody.includes("(c.payload ->> 'proposalId') = p_proposal_id::text"));
});

check('11. exige actionType create_calendar_event — nunca cancela create_local_task por esta RPC', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(privateBody.includes("(c.payload -> 'action' ->> 'actionType') = 'create_calendar_event'"));
});

check('12. usa expires_at > now() do banco — nunca p_now', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(/c\.expires_at > now\(\)/.test(privateBody));
  assert.ok(!/\bp_now\b/.test(migrationCodeOnly));
});

// ============================================================================
// 13-16. Os dois branches finais
// ============================================================================

check('13. sem execution -> DELETE runtime (filtro exato user_id+state_id) + cancelled', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(
    /delete from public\.conversation_runtime_states\s*\n\s*where user_id = v_user_id\s*\n\s*and state_id = p_expected_state_id;/.test(
      privateBody,
    ),
  );
  assert.ok(privateBody.includes("'cancelled'::text"));
  const deleteIndex = privateBody.indexOf('delete from public.conversation_runtime_states');
  const cancelledIndex = privateBody.indexOf("'cancelled'::text");
  assert.ok(deleteIndex !== -1 && cancelledIndex !== -1 && deleteIndex < cancelledIndex);
});

check('14. execution existente -> execution_started', () => {
  const privateBody = fnBodyOf('private');
  const executionFoundBranch = privateBody.match(/if v_execution_found then([\s\S]*?)end if;/);
  assert.ok(executionFoundBranch, 'branch de execution encontrada não localizado');
  assert.ok(/'execution_started'/.test(executionFoundBranch[1]));
});

check('15. execution existente -> ZERO DELETE na runtime dentro desse branch', () => {
  const privateBody = fnBodyOf('private');
  const executionFoundBranch = privateBody.match(/if v_execution_found then([\s\S]*?)end if;/)[1];
  assert.ok(!/delete/i.test(executionFoundBranch));
});

check('16. execution existente -> ZERO UPDATE em calendar_event_executions/completed_at em qualquer parte da função', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(!/update public\.calendar_event_executions/i.test(privateBody));
  assert.ok(!/completed_at\s*=/i.test(privateBody));
});

// ============================================================================
// 17-20. Todos os motivos de conflict colapsam uniformemente
// ============================================================================

check('17, 18, 19 e 20. runtime não encontrada (ausente/stale/expirada/proposalId divergente) -> conflict, sem segunda query', () => {
  const privateBody = fnBodyOf('private');
  const notFoundBranch = privateBody.match(/if not v_runtime_found then([\s\S]*?)end if;/);
  assert.ok(notFoundBranch, 'branch not found da runtime não localizado');
  assert.ok(notFoundBranch[1].includes("'conflict'::text"));
  // Nenhuma segunda consulta tentando "explicar" a causa dentro deste
  // branch — só o `select 'conflict'::text` de retorno (que não é uma
  // consulta a tabela nenhuma), nunca um `from` real.
  assert.ok(!/\bfrom\b/i.test(notFoundBranch[1]));
});

check('21. local-task proposal -> conflict (actionType create_calendar_event é exigido na MESMA query da runtime)', () => {
  const privateBody = fnBodyOf('private');
  // A condição de actionType está na mesma cláusula WHERE do lock da
  // runtime — não há como uma proposal create_local_task nunca chegar
  // sequer a ser encontrada por esta RPC.
  const runtimeQueryMatch = privateBody.match(
    /from public\.conversation_runtime_states c\s*\n\s*where[\s\S]*?for update;/,
  );
  assert.ok(runtimeQueryMatch, 'query de lock da runtime não encontrada');
  assert.ok(runtimeQueryMatch[0].includes("'create_calendar_event'"));
});

// ============================================================================
// 22. Isolamento por usuário
// ============================================================================

check('22. toda consulta a conversation_runtime_states e calendar_event_executions filtra por user_id/v_user_id', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(/c\.user_id = v_user_id/.test(privateBody));
  const executionQueries = [...privateBody.matchAll(/from public\.calendar_event_executions e[\s\S]*?;/g)].map(
    (m) => m[0],
  );
  assert.ok(executionQueries.length >= 1, 'esperava pelo menos 1 consulta a calendar_event_executions');
  for (const query of executionQueries) {
    assert.ok(/e\.user_id = v_user_id/.test(query), `consulta sem filtro de user_id: ${query}`);
  }
});

// ============================================================================
// 23. Segurança SQL / grants mínimos, zero grants diretos novos nas tabelas
// ============================================================================

check('função privada é SECURITY DEFINER com search_path fixo em \'\'', () => {
  const body = fnBodyOf('private');
  assert.ok(/security definer/.test(body));
  assert.ok(/set search_path = ''/.test(body));
});

check('wrapper público é SECURITY INVOKER (não DEFINER) e só repassa a chamada', () => {
  const body = fnBodyOf('public');
  assert.ok(/security invoker/.test(body));
  assert.ok(!/security definer/.test(body));
  assert.ok(body.includes('select * from private.cancel_calendar_event_proposal(p_expected_state_id, p_proposal_id)'));
});

check('23. grants mínimos: revoke de public + grant só para authenticated, nas duas funções; zero grant direto novo nas tabelas', () => {
  assert.ok(
    migrationCodeOnly.includes('revoke all on function private.cancel_calendar_event_proposal(uuid, uuid) from public'),
  );
  assert.ok(
    migrationCodeOnly.includes(
      'grant execute on function private.cancel_calendar_event_proposal(uuid, uuid) to authenticated',
    ),
  );
  assert.ok(
    migrationCodeOnly.includes('revoke all on function public.cancel_calendar_event_proposal(uuid, uuid) from public'),
  );
  assert.ok(
    migrationCodeOnly.includes(
      'grant execute on function public.cancel_calendar_event_proposal(uuid, uuid) to authenticated',
    ),
  );
  assert.ok(!/grant execute[^;]*to anon/i.test(migrationCodeOnly));
  assert.ok(!/grant [^;]*on public\.calendar_event_executions/i.test(migrationCodeOnly));
  assert.ok(!/grant [^;]*on public\.conversation_runtime_states/i.test(migrationCodeOnly));
  assert.ok(!/grant create on schema private/i.test(migrationCodeOnly));
  assert.ok(!migrationCodeOnly.includes('service_role'));
});

// ============================================================================
// Zero Google/tokens/admin/overclaim em qualquer lugar da migration
// ============================================================================

check('zero menção a events.insert/googleapis/tokens/cancelamento real no Google nesta migration', () => {
  const forbidden = ['events.insert', 'googleapis.com', 'access_token', 'refresh_token'];
  for (const token of forbidden) {
    assert.ok(!migrationCodeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('zero service_role/admin nesta migration', () => {
  const forbidden = ['service_role', 'SUPABASE_SECRET_KEY', 'createAdminClient'];
  for (const token of forbidden) {
    assert.ok(!migrationCodeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('nenhuma menção a "linearizad[oa]" (mesma disciplina anti-overclaim de claim/finalize)', () => {
  assert.ok(!/linearizad[ao]/i.test(migration));
});

check('esta migration nunca tenta cancelar um evento real no Google — documentado explicitamente', () => {
  assert.ok(/NUNCA tenta cancelar um evento no Google Calendar/.test(migration));
});

// ============================================================================
// RACE ESTRUTURAL (cross-migration) — claim, finalize e cancel
//
// Prova apenas ESTRUTURA do SQL (ordem de statements, campos usados nas
// mesmas cláusulas WHERE) — nunca finge provar atomicidade/concorrência
// real entre chamadas simultâneas, que só um Postgres real poderia
// exercitar. A ausência de Postgres local/Docker neste ambiente já foi
// confirmada em subfases anteriores.
// ============================================================================

const claimPrivateBody = fnBodyFrom(claimCodeOnly, 'private', 'claim_calendar_event_execution');
const finalizePrivateBody = fnBodyFrom(finalizeCodeOnly, 'private', 'finalize_calendar_event_execution');
const cancelPrivateBody = fnBodyOf('private');

check('43. claim e cancel travam a runtime pela MESMA identidade (user_id, state_id, kind, proposalId)', () => {
  const identityFragments = [
    'c.user_id = v_user_id',
    'c.state_id = p_expected_state_id',
    "c.state_kind = 'proposal'",
    "(c.payload ->> 'proposalId') = p_proposal_id::text",
  ];
  for (const fragment of identityFragments) {
    assert.ok(claimPrivateBody.includes(fragment), `claim não contém: ${fragment}`);
    assert.ok(cancelPrivateBody.includes(fragment), `cancel não contém: ${fragment}`);
  }
});

// Nota: claim (diferente de cancel/finalize) tem um SELECT NÃO travado
// (sem `for update`) sobre calendar_event_executions ANTES de travar a
// runtime — é o check de retry idempotente `already_claimed`, já provado
// inofensivo em Subfase 4 (uma leitura sem `for update` não adquire lock
// nenhum, então não participa da ordem de AQUISIÇÃO de locks). Por isso a
// comparação certa não é "o que é mencionado primeiro no texto", e sim
// "qual tabela o PRIMEIRO `for update` da função efetivamente trava".
function tableLockedByFirstForUpdate(body) {
  const firstForUpdateIndex = body.indexOf('for update');
  assert.ok(firstForUpdateIndex !== -1, 'nenhum for update encontrado');
  const lastFromBeforeLock = body.lastIndexOf('from public.', firstForUpdateIndex);
  assert.ok(lastFromBeforeLock !== -1, 'nenhum FROM encontrado antes do primeiro for update');
  if (body.slice(lastFromBeforeLock).startsWith('from public.conversation_runtime_states')) {
    return 'conversation_runtime_states';
  }
  if (body.slice(lastFromBeforeLock).startsWith('from public.calendar_event_executions')) {
    return 'calendar_event_executions';
  }
  throw new Error(`tabela não reconhecida travada pelo primeiro for update: ${body.slice(lastFromBeforeLock, lastFromBeforeLock + 60)}`);
}

check('44. claim e cancel: o PRIMEIRO `for update` de cada função sempre trava conversation_runtime_states (nunca calendar_event_executions)', () => {
  assert.equal(tableLockedByFirstForUpdate(claimPrivateBody), 'conversation_runtime_states');
  assert.equal(tableLockedByFirstForUpdate(cancelPrivateBody), 'conversation_runtime_states');
});

check('45. finalize e cancel: o PRIMEIRO `for update` de cada função sempre trava conversation_runtime_states (nunca calendar_event_executions)', () => {
  assert.equal(tableLockedByFirstForUpdate(finalizePrivateBody), 'conversation_runtime_states');
  assert.equal(tableLockedByFirstForUpdate(cancelPrivateBody), 'conversation_runtime_states');
});

check(
  '46. cancel vencedor impede claim futuro estruturalmente — o INSERT do claim só é alcançável DEPOIS do lock+checagem bem-sucedida da runtime (nunca antes)',
  () => {
    // No claim, a ÚNICA forma de chegar ao INSERT é passar pelo `if not
    // found then return conflict end if` da runtime — ou seja, se o
    // cancel já apagou a runtime, o `for update` do claim não encontra
    // nada e o claim nunca alcança o INSERT (a mesma linha não pode
    // "reaparecer" depois de um DELETE commitado). Prova estrutural:
    // o texto do INSERT vem DEPOIS do `if not found` que guarda a
    // runtime, e não existe nenhum caminho de código que pule essa
    // checagem.
    const runtimeNotFoundIndex = claimPrivateBody.indexOf('if not found then');
    const insertIndex = claimPrivateBody.indexOf('insert into public.calendar_event_executions');
    assert.ok(runtimeNotFoundIndex !== -1 && insertIndex !== -1);
    assert.ok(runtimeNotFoundIndex < insertIndex, 'INSERT do claim deveria vir depois da checagem de runtime não encontrada');
    // E o próprio `for update` da runtime vem antes dessa checagem —
    // fechando a cadeia lock -> checagem -> insert.
    const runtimeForUpdateIndex = claimPrivateBody.lastIndexOf('for update', runtimeNotFoundIndex);
    assert.ok(runtimeForUpdateIndex !== -1 && runtimeForUpdateIndex < runtimeNotFoundIndex);
  },
);

check(
  '47. claim vencedor faz cancel recusar estruturalmente — o DELETE do cancel só é alcançável se a checagem de execution NÃO a encontrar (nunca em paralelo/depois)',
  () => {
    // Em cancel, a única forma de chegar ao DELETE é o `if v_execution_found
    // then return execution_started end if` ter sido FALSO — ou seja, se o
    // claim já inseriu a execution antes de cancel travar a runtime, o
    // `for update` de cancel sobre calendar_event_executions encontra a
    // linha e cancel nunca alcança o DELETE.
    const executionFoundBranch = cancelPrivateBody.match(/if v_execution_found then([\s\S]*?)end if;/);
    assert.ok(executionFoundBranch);
    const executionFoundBranchEndIndex = cancelPrivateBody.indexOf(executionFoundBranch[0]) + executionFoundBranch[0].length;
    const deleteIndex = cancelPrivateBody.indexOf('delete from public.conversation_runtime_states');
    assert.ok(deleteIndex !== -1, 'DELETE não encontrado em cancel');
    assert.ok(
      deleteIndex > executionFoundBranchEndIndex,
      'DELETE deveria vir depois do branch que verifica execution_found (nunca antes/em paralelo)',
    );
    // E não existe NENHUM outro `if`/branch entre o fim desse bloco e o
    // DELETE que pudesse desviar o fluxo — só a checagem de execution
    // decide se o DELETE é alcançado.
    const between = cancelPrivateBody.slice(executionFoundBranchEndIndex, deleteIndex);
    assert.ok(!/\bif\b/i.test(between), 'não deveria haver outro branch entre a checagem de execution e o DELETE');
  },
);

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
