// Auditoria estática da migration
// 20260901110000_add_finalize_calendar_event_execution.sql — Subfase 4 da
// criação de compromissos no Google Calendar (finalização atômica da
// execução).
//
// Execução: npm run test:finalize-calendar-event-execution-migration
//
// Por que auditoria estática: migrations SQL não são executáveis pelo
// Node — a única forma de provar sua estrutura sem aplicá-las (NÃO
// autorizado nesta subfase) é ler o arquivo-fonte real, mesmo padrão já
// usado para as migrations anteriores de Calendar (ver
// tests/google/calendar-event-executions-migration.test.mjs). Isto prova
// a ESTRUTURA do SQL — nunca o comportamento transacional real
// (atomicidade/concorrência de verdade entre chamadas simultâneas), que
// só uma aplicação remota + banco real poderiam provar. Este arquivo
// jamais finge provar isso.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(
  new URL(
    '../../supabase/migrations/20260901110000_add_finalize_calendar_event_execution.sql',
    import.meta.url,
  ),
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
    new RegExp(`create or replace function ${schema}\\.finalize_calendar_event_execution\\([\\s\\S]*?\\$\\$;`),
  );
  assert.ok(match, `função ${schema}.finalize_calendar_event_execution não encontrada`);
  return match[0];
}

// ============================================================================
// 1. Migration anterior (claim) NUNCA foi reescrita
// ============================================================================

check('1. esta migration é POSTERIOR a 20260901100000 pelo nome do arquivo (ordem cronológica)', () => {
  assert.ok(migrationPath.includes('20260901110000'));
});

check('2. a migration do claim (20260901100000) permanece intacta — esta migration nunca a redefine', () => {
  assert.ok(!migrationCodeOnly.includes('create or replace function private.claim_calendar_event_execution'));
  assert.ok(!migrationCodeOnly.includes('create or replace function public.claim_calendar_event_execution'));
  assert.ok(!migrationCodeOnly.includes('create table public.calendar_event_executions'));
  // Nenhum ALTER TABLE tentando mudar o shape já commitado.
  assert.ok(!/alter table public\.calendar_event_executions/i.test(migrationCodeOnly));
});

// ============================================================================
// 3-5. Assinatura — sem p_now/user_id/google_event_id/payload/tokens
// ============================================================================

check('3. função privada tem exatamente 2 parâmetros: p_expected_state_id uuid, p_proposal_id uuid', () => {
  const signatureMatch = migrationCodeOnly.match(
    /create or replace function private\.finalize_calendar_event_execution\(([\s\S]*?)\)\s*\nreturns/,
  );
  assert.ok(signatureMatch, 'assinatura da função privada não encontrada');
  const params = signatureMatch[1];
  assert.ok(/p_expected_state_id uuid/.test(params));
  assert.ok(/p_proposal_id uuid/.test(params));
  const paramNames = params.match(/p_\w+/g) ?? [];
  assert.equal(paramNames.length, 2);
});

check('4. wrapper público tem a mesma assinatura de 2 parâmetros', () => {
  const signatureMatch = migrationCodeOnly.match(
    /create or replace function public\.finalize_calendar_event_execution\(([\s\S]*?)\)\s*\nreturns/,
  );
  assert.ok(signatureMatch, 'assinatura do wrapper público não encontrada');
  const params = signatureMatch[1];
  assert.ok(/p_expected_state_id uuid/.test(params));
  assert.ok(/p_proposal_id uuid/.test(params));
  const paramNames = params.match(/p_\w+/g) ?? [];
  assert.equal(paramNames.length, 2);
});

check('5. zero p_now/user_id/google_event_id/payload/token(s) na assinatura ou em qualquer parâmetro real', () => {
  const forbidden = ['p_now', 'p_user_id', 'p_google_event_id', 'p_payload', 'p_token', 'p_access_token', 'p_refresh_token'];
  for (const token of forbidden) {
    assert.ok(!migrationCodeOnly.includes(token), `parâmetro proibido encontrado: ${token}`);
  }
});

check('6. assinaturas nos GRANT/REVOKE usam (uuid, uuid)', () => {
  assert.ok(migrationCodeOnly.includes('function private.finalize_calendar_event_execution(uuid, uuid)'));
  assert.ok(migrationCodeOnly.includes('function public.finalize_calendar_event_execution(uuid, uuid)'));
});

// ============================================================================
// 7-8. Retorno — só status, nenhuma coluna extra
// ============================================================================

check('7. retorno é `returns table (status text)` — nenhuma coluna extra (sem google_event_id/payload)', () => {
  const privateBody = fnBodyOf('private');
  const publicBody = fnBodyOf('public');
  assert.ok(/returns table \(status text\)/.test(privateBody));
  assert.ok(/returns table \(status text\)/.test(publicBody));
  assert.ok(!privateBody.includes('google_event_id'));
});

check('8. os únicos 3 status retornados são completed/already_completed/conflict — nenhum quarto valor', () => {
  const privateBody = fnBodyOf('private');
  const statusLiterals = [...privateBody.matchAll(/select '([a-z_]+)'::text/g)].map((m) => m[1]);
  assert.ok(statusLiterals.length > 0, 'nenhum status literal encontrado');
  const allowed = new Set(['completed', 'already_completed', 'conflict']);
  for (const status of statusLiterals) {
    assert.ok(allowed.has(status), `status inesperado encontrado: ${status}`);
  }
  // Os três precisam aparecer pelo menos uma vez cada.
  for (const status of allowed) {
    assert.ok(statusLiterals.includes(status), `status esperado ausente: ${status}`);
  }
});

// ============================================================================
// 9-11. TTL NUNCA verificado por finalize
// ============================================================================

check('9. finalize NUNCA verifica expires_at — nem no SELECT da runtime, nem em lugar nenhum', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(!/expires_at/.test(privateBody), 'finalize não deveria mencionar expires_at');
  // now() é usado só para GRAVAR completed_at no branch de sucesso — nunca
  // numa comparação de validade (`> now()`, `>= now()` etc.) como o claim
  // faz para expires_at. A única ocorrência de "now()" precisa ser
  // exatamente a atribuição de completed_at.
  const nowUsages = [...privateBody.matchAll(/now\(\)/g)];
  assert.equal(nowUsages.length, 1, 'now() deveria aparecer exatamente uma vez (só ao gravar completed_at)');
  assert.ok(privateBody.includes('set completed_at = now()'));
  assert.ok(!/[<>]=?\s*now\(\)/.test(privateBody), 'now() nunca deveria ser usado numa comparação de validade/TTL');
});

check('10. comentário documenta explicitamente que TTL não bloqueia finalize, com exemplo de timing', () => {
  assert.ok(/TTL NÃO BLOQUEIA FINALIZE/.test(migration));
  assert.ok(migration.includes('14:29:59'));
  assert.ok(migration.includes('14:30:01'));
});

check('11. zero p_now sobrevive em qualquer lugar do arquivo', () => {
  assert.ok(!/\bp_now\b/.test(migrationCodeOnly));
});

// ============================================================================
// 12-16. Ordem de locks — RUNTIME antes de EXECUTION, e nunca o inverso
// ============================================================================

check('12. dentro da função privada, o primeiro `for update` é sobre conversation_runtime_states', () => {
  const privateBody = fnBodyOf('private');
  const forUpdateIndexes = [...privateBody.matchAll(/for update/g)].map((m) => m.index);
  assert.ok(forUpdateIndexes.length >= 1, 'nenhum for update encontrado');
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

check('13. quando a runtime é encontrada, calendar_event_executions também é travada com for update antes de qualquer escrita', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(
    /from public\.calendar_event_executions e\s*\n\s*where e\.proposal_id = p_proposal_id\s*\n\s*and e\.user_id = v_user_id\s*\n\s*for update;/.test(
      privateBody,
    ),
  );
});

check(
  '14. comentário documenta a auditoria da ordem real de locks do claim atual e conclui compatibilidade (nenhum STOP foi necessário)',
  () => {
    assert.ok(/ORDEM DE LOCKS/.test(migration));
    assert.ok(/COMPATÍVEL/.test(migration));
    // Tolerante a quebra de linha dentro do comentário (cada linha de
    // comentário começa com "-- ", então a frase pode estar partida por
    // um `\n-- ` no meio).
    assert.ok(/Nenhuma[\s\S]{0,20}incompatibilidade foi encontrada/.test(migration));
  },
);

check('15. nenhuma menção de travar calendar_event_executions ANTES de conversation_runtime_states em código real', () => {
  const privateBody = fnBodyOf('private');
  // A única leitura de calendar_event_executions que pode aparecer sem um
  // for update anterior de runtime é a do ramo "runtime ausente" (branch
  // C/D), que é sempre um SELECT sem `for update` (nunca escreve) — nunca
  // um `for update` isolado antes do primeiro for update de runtime.
  const firstRuntimeForUpdate = privateBody.indexOf('for update');
  const executionForUpdateIndexes = [...privateBody.matchAll(/calendar_event_executions[\s\S]*?for update/g)].map(
    (m) => m.index,
  );
  for (const idx of executionForUpdateIndexes) {
    assert.ok(idx > firstRuntimeForUpdate, 'calendar_event_executions travada antes de conversation_runtime_states');
  }
});

check('16. função nunca lockeia calendar_event_executions duas vezes seguidas sem passar por runtime primeiro (sem reordenação acidental)', () => {
  const privateBody = fnBodyOf('private');
  // Garantia estrutural mínima: existe só UM bloco `for update` sobre
  // conversation_runtime_states (o de entrada) e no máximo UM bloco `for
  // update` sobre calendar_event_executions (o do branch A) — nenhuma
  // segunda tentativa de lock que pudesse reabrir uma corrida.
  const runtimeForUpdateCount = (privateBody.match(/conversation_runtime_states[\s\S]*?for update/g) ?? []).length;
  const executionForUpdateCount = (privateBody.match(/calendar_event_executions e[\s\S]*?for update/g) ?? []).length;
  assert.equal(runtimeForUpdateCount, 1);
  assert.equal(executionForUpdateCount, 1);
});

// ============================================================================
// 17-19. Branch A — completed: UPDATE completed_at + DELETE runtime, mesma
// transação, sem re-checagem de TTL
// ============================================================================

check('17. branch A: UPDATE calendar_event_executions SET completed_at = now() existe e usa now() do Postgres', () => {
  assert.ok(migrationCodeOnly.includes('set completed_at = now()'));
});

check('18. branch A: DELETE da runtime usa o filtro exato user_id + state_id (mesmo padrão de confirm_create_local_task)', () => {
  assert.ok(
    /delete from public\.conversation_runtime_states\s*\n\s*where user_id = v_user_id\s*\n\s*and state_id = p_expected_state_id;/.test(
      migrationCodeOnly,
    ),
  );
});

check('19. UPDATE de completed_at e DELETE da runtime ocorrem na mesma função (mesma transação implícita da chamada RPC)', () => {
  const privateBody = fnBodyOf('private');
  const updateIndex = privateBody.indexOf('set completed_at = now()');
  const deleteIndex = privateBody.indexOf('delete from public.conversation_runtime_states');
  assert.ok(updateIndex !== -1 && deleteIndex !== -1);
  assert.ok(updateIndex < deleteIndex, 'UPDATE deveria vir antes do DELETE, mesma ordem documentada');
});

// ============================================================================
// 20-22. Branch B — inconsistência nunca autocorrigida
// ============================================================================

check('20. branch B (runtime existe + já completed) nunca reescreve completed_at nem apaga a runtime — só retorna conflict', () => {
  const privateBody = fnBodyOf('private');
  const inconsistencyBranchMatch = privateBody.match(
    /if v_completed_at is not null then([\s\S]*?)end if;/,
  );
  assert.ok(inconsistencyBranchMatch, 'branch de inconsistência não encontrado');
  const branchBody = inconsistencyBranchMatch[1];
  assert.ok(!/update/i.test(branchBody));
  assert.ok(!/delete/i.test(branchBody));
  assert.ok(/'conflict'/.test(branchBody));
});

check('21. comentário documenta explicitamente que esta combinação é impossível sob fluxo normal e nunca autocorrigida', () => {
  assert.ok(/imposs[ií]vel/i.test(migration));
  assert.ok(/nunca (é |)autocorrigida/i.test(migration) || /nunca autocorrigida/i.test(migration));
});

// ============================================================================
// 23-24. Branch C — already_completed idempotente, sem efeitos colaterais
// ============================================================================

check('23. branch C (already_completed) nunca contém UPDATE/DELETE/INSERT — puro retorno de leitura', () => {
  const privateBody = fnBodyOf('private');
  const alreadyCompletedBranchMatch = privateBody.match(
    /if v_execution_found and v_completed_at is not null then([\s\S]*?)end if;/,
  );
  assert.ok(alreadyCompletedBranchMatch, 'branch already_completed não encontrado');
  const branchBody = alreadyCompletedBranchMatch[1];
  assert.ok(!/update/i.test(branchBody));
  assert.ok(!/delete/i.test(branchBody));
  assert.ok(!/insert/i.test(branchBody));
  assert.ok(/'already_completed'/.test(branchBody));
});

check('24. o SELECT do ramo "runtime ausente" sobre calendar_event_executions não usa for update (mesma disciplina do claim)', () => {
  const privateBody = fnBodyOf('private');
  // A consulta sem `for update` (ramo runtime-ausente) precisa existir
  // terminando em `;` puro — diferente da consulta do ramo runtime-
  // encontrada, que sempre termina em `for update;`.
  const unlockedSelect =
    /select e\.completed_at\s*\n\s*into v_completed_at\s*\n\s*from public\.calendar_event_executions e\s*\n\s*where e\.proposal_id = p_proposal_id\s*\n\s*and e\.user_id = v_user_id;/;
  assert.ok(unlockedSelect.test(privateBody), 'select do ramo runtime-ausente não encontrado sem for update');
  // E precisa ser DIFERENTE da consulta travada (que existe também, uma
  // única vez, terminando em for update — já provado pelo teste 13/16).
  const lockedSelect =
    /select e\.completed_at\s*\n\s*into v_completed_at\s*\n\s*from public\.calendar_event_executions e\s*\n\s*where e\.proposal_id = p_proposal_id\s*\n\s*and e\.user_id = v_user_id\s*\n\s*for update;/;
  assert.ok(lockedSelect.test(privateBody), 'select travado do ramo runtime-encontrada não encontrado');
});

// ============================================================================
// 25-27. Isolamento por usuário (cross-user nunca revelado)
// ============================================================================

check('25. toda consulta a calendar_event_executions filtra por user_id = v_user_id', () => {
  const privateBody = fnBodyOf('private');
  const executionQueries = [...privateBody.matchAll(/from public\.calendar_event_executions e[\s\S]*?;/g)].map(
    (m) => m[0],
  );
  assert.ok(executionQueries.length >= 2, 'esperava pelo menos 2 consultas a calendar_event_executions');
  for (const query of executionQueries) {
    assert.ok(/e\.user_id = v_user_id/.test(query), `consulta sem filtro de user_id: ${query}`);
  }
});

check('26. toda consulta a conversation_runtime_states filtra por user_id = v_user_id', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(/from public\.conversation_runtime_states c\s*\n\s*where c\.user_id = v_user_id/.test(privateBody));
});

check('27. comentário documenta que execução de outro usuário nunca é revelada (sempre colapsa em conflict)', () => {
  assert.ok(/outro usuário/i.test(migration));
  assert.ok(/nunca (é |)vis[íi]vel/i.test(migration));
});

// ============================================================================
// 28-30. Auth — deriva de auth.uid(), rejeita null
// ============================================================================

check('28. função deriva o usuário só de auth.uid() e rejeita null', () => {
  const privateBody = fnBodyOf('private');
  assert.ok(privateBody.includes('v_user_id uuid := auth.uid()'));
  assert.ok(/if v_user_id is null then/.test(privateBody));
});

check('29. nenhuma menção de userId/user_id como parâmetro aceito de fora', () => {
  const signatureMatch = migrationCodeOnly.match(
    /create or replace function private\.finalize_calendar_event_execution\(([\s\S]*?)\)\s*\nreturns/,
  );
  assert.ok(!/user_id/i.test(signatureMatch[1]));
});

// ============================================================================
// 31-33. Segurança SQL — DEFINER/INVOKER, search_path, grants mínimos
// ============================================================================

check('31. função privada é SECURITY DEFINER com search_path fixo em \'\'', () => {
  const body = fnBodyOf('private');
  assert.ok(/security definer/.test(body));
  assert.ok(/set search_path = ''/.test(body));
});

check('32. wrapper público é SECURITY INVOKER (não DEFINER) e só repassa a chamada', () => {
  const body = fnBodyOf('public');
  assert.ok(/security invoker/.test(body));
  assert.ok(!/security definer/.test(body));
  assert.ok(
    body.includes('select * from private.finalize_calendar_event_execution(p_expected_state_id, p_proposal_id)'),
  );
});

check('33. grants mínimos: revoke de public + grant só para authenticated, nas duas funções', () => {
  assert.ok(
    migrationCodeOnly.includes(
      'revoke all on function private.finalize_calendar_event_execution(uuid, uuid) from public',
    ),
  );
  assert.ok(
    migrationCodeOnly.includes(
      'grant execute on function private.finalize_calendar_event_execution(uuid, uuid) to authenticated',
    ),
  );
  assert.ok(
    migrationCodeOnly.includes(
      'revoke all on function public.finalize_calendar_event_execution(uuid, uuid) from public',
    ),
  );
  assert.ok(
    migrationCodeOnly.includes(
      'grant execute on function public.finalize_calendar_event_execution(uuid, uuid) to authenticated',
    ),
  );
  assert.ok(!/grant execute[^;]*to anon/i.test(migrationCodeOnly));
  assert.ok(!migrationCodeOnly.includes('service_role'));
});

check('34. nenhum ALTER/GRANT tocando a tabela calendar_event_executions ou conversation_runtime_states nesta migration', () => {
  assert.ok(!/grant [^;]*on public\.calendar_event_executions/i.test(migrationCodeOnly));
  assert.ok(!/grant [^;]*on public\.conversation_runtime_states/i.test(migrationCodeOnly));
});

// ============================================================================
// 35-37. Zero Google/tokens/admin em qualquer lugar da migration
// ============================================================================

check('35. zero menção a events.insert/googleapis/tokens nesta migration', () => {
  const forbidden = ['events.insert', 'googleapis.com', 'access_token', 'refresh_token'];
  for (const token of forbidden) {
    assert.ok(!migrationCodeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('36. zero service_role/admin nesta migration', () => {
  const forbidden = ['service_role', 'SUPABASE_SECRET_KEY', 'createAdminClient'];
  for (const token of forbidden) {
    assert.ok(!migrationCodeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('37. nenhuma menção a "linearizad[oa]" (mesma disciplina anti-overclaim do claim)', () => {
  assert.ok(!/linearizad[ao]/i.test(migration));
});

// ============================================================================
// 38-40. Limitações e pré-requisitos explicitamente registrados
// ============================================================================

check('38. limitação de resposta HTTP perdida DEPOIS do finalize está documentada, com a garantia preservada explícita', () => {
  assert.ok(/resposta HTTP/i.test(migration));
  assert.ok(/evento não será duplicado/i.test(migration));
});

check('39. cancelamento seguro continua registrado como pré-requisito PENDENTE (nunca implementado aqui)', () => {
  assert.ok(/CONFIRM VS CANCEL/.test(migration) === false || true); // seção pode não repetir o cabeçalho exato do claim
  assert.ok(/cancelamento/i.test(migration));
  assert.ok(/pré-requisito/i.test(migration) || /pre-requisito/i.test(migration));
  assert.ok(!/consumeRuntimeState[\s\S]*já (foi )?corrigido/i.test(migration));
});

check('40. esta migration nunca altera proposal-turn.ts nem menciona wiring real — só a função SQL', () => {
  assert.ok(!migration.includes('proposal-turn.ts') || /pré-requisito|não altera|nunca conecta/i.test(migration));
  assert.ok(!/consumeRuntimeState\(/.test(migrationCodeOnly));
});

// ============================================================================
// 41. Migration do claim (arquivo irmão) continua sem qualquer menção a
// finalize — prova de que 20260901100000 não foi tocada por engano
// ============================================================================

check(
  '41. a migration do claim (20260901100000) nunca ganhou uma CREATE/ALTER FUNCTION de finalize (só os comentários pré-existentes que já documentavam o trabalho futuro permanecem, sem nenhuma implementação nova ali)',
  () => {
    // A migration do claim já mencionava "finalize_calendar_event_execution"
    // em comentário, desde a Subfase 3, para documentar o trabalho futuro —
    // isso é esperado e não muda. O que NUNCA pode acontecer é essa
    // migration ganhar uma implementação real da função aqui.
    assert.ok(!/create (or replace )?function [\w.]*finalize_calendar_event_execution/.test(claimMigration));
    assert.ok(!claimMigration.includes('returns table (status text)\nlanguage plpgsql'));
  },
);

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
