// Testes unitários de src/lib/conversation/local-task-execution.ts.
//
// Execução: npm run test:local-task-execution
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão de
// tests/security/rls.test.mjs e tests/conversation/proposal-turn.test.mjs.
//
// A migration `confirm_create_local_task` NÃO foi aplicada no Supabase
// remoto — nenhum destes testes chama banco real. A única peça
// substituída é `../supabase/server` (createClient), via
// tests/support/fake-supabase-server.mjs, redirecionado só neste
// processo de teste (ver tests/support/ts-extension-loader.mjs).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { executeCreateLocalTask } from '../../src/lib/conversation/local-task-execution.ts';
import { handlers as rpcHandlers } from '../support/fake-supabase-server.mjs';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function check(name, fn) {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    record(name, false, err.message);
  }
}

function setRpc(fn) {
  rpcHandlers.rpc = fn;
}

// --- Fixtures reais (nenhum dado pessoal) -----------------------------

const NOW = 1_700_000_000_000; // epoch ms — mesma unidade usada em toda a conversation layer
const EXPECTED_ISO = new Date(NOW).toISOString();
const VALID_UUID = '11111111-2222-4333-8444-555555555555';

const FULL_TASK = {
  title: 'Enviar relatório',
  description: 'Relatório mensal de vendas',
  deadline: { at: '2026-09-01T12:00:00.000Z', source: 'stated' },
  duration: { minutes: 30, source: 'inferred' },
};

const MINIMAL_TASK = {
  title: 'Ligar para o cliente',
  description: null,
  deadline: null,
  duration: null,
};

function capturingRpc(responder) {
  const calls = [];
  setRpc(async (fn, args) => {
    calls.push({ fn, args });
    return responder(fn, args);
  });
  return calls;
}

// ============================================================================
// 1-4. CHAMADA EXATA DA RPC — nome, expectedStateId, proposalId, now
// ============================================================================

await check('1. chama exatamente "confirm_create_local_task"', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'confirm_create_local_task');
});

await check('2. usa p_expected_state_id correto', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'distinctive-state-id', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.equal(calls[0].args.p_expected_state_id, 'distinctive-state-id');
});

await check('3. usa p_proposal_id correto', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'distinctive-proposal-id', task: MINIMAL_TASK, now: NOW });
  assert.equal(calls[0].args.p_proposal_id, 'distinctive-proposal-id');
});

await check('4. converte now (epoch ms) para ISO string em p_now', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.equal(calls[0].args.p_now, EXPECTED_ISO);
});

// ============================================================================
// 5-11. MAPEAMENTO DO TASK
// ============================================================================

await check('5. mapeia title', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: FULL_TASK, now: NOW });
  assert.equal(calls[0].args.p_title, 'Enviar relatório');
});

await check('6. description presente é preservada', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: FULL_TASK, now: NOW });
  assert.equal(calls[0].args.p_description, 'Relatório mensal de vendas');
});

await check('7. description null vira p_description null', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.equal(calls[0].args.p_description, null);
});

await check('8. deadline presente vira p_deadline_at = deadline.at', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: FULL_TASK, now: NOW });
  assert.equal(calls[0].args.p_deadline_at, '2026-09-01T12:00:00.000Z');
});

await check('9. deadline null vira p_deadline_at null (nunca undefined)', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.equal(calls[0].args.p_deadline_at, null);
  assert.ok('p_deadline_at' in calls[0].args);
});

await check('10. duration presente vira p_duration_minutes = duration.minutes', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: FULL_TASK, now: NOW });
  assert.equal(calls[0].args.p_duration_minutes, 30);
});

await check('11. duration null vira p_duration_minutes null (nunca undefined)', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.equal(calls[0].args.p_duration_minutes, null);
  assert.ok('p_duration_minutes' in calls[0].args);
});

// ============================================================================
// 12-13. RESULTADOS VÁLIDOS
// ============================================================================

await check('12. created + UUID válido -> { status: created, itemId }', async () => {
  setRpc(async () => ({ data: [{ status: 'created', item_id: VALID_UUID }], error: null }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'created', itemId: VALID_UUID });
});

await check('13. conflict + item_id null -> { status: conflict }', async () => {
  setRpc(async () => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'conflict' });
});

// ============================================================================
// 14-19. VALIDAÇÃO DEFENSIVA DO RETORNO — shape inválido -> error
// ============================================================================

await check('14. erro técnico do supabase.rpc -> error, nada vazado', async () => {
  setRpc(async () => ({ data: null, error: { message: 'segredo interno', code: '23505', details: 'x', hint: 'y' } }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
  assert.deepEqual(Object.keys(result), ['status']);
});

await check('15. status desconhecido -> error', async () => {
  setRpc(async () => ({ data: [{ status: 'quem-sabe', item_id: null }], error: null }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
});

await check('16. created sem item_id (null) -> error', async () => {
  setRpc(async () => ({ data: [{ status: 'created', item_id: null }], error: null }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
});

await check('16b. created com item_id que não parece UUID -> error', async () => {
  setRpc(async () => ({ data: [{ status: 'created', item_id: 'nao-e-um-uuid' }], error: null }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
});

await check('17. conflict com item_id inesperado (não-null) -> error', async () => {
  setRpc(async () => ({ data: [{ status: 'conflict', item_id: VALID_UUID }], error: null }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
});

await check('18. array vazio -> error', async () => {
  setRpc(async () => ({ data: [], error: null }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
});

await check('19. múltiplas rows inesperadas -> error', async () => {
  setRpc(async () => ({
    data: [
      { status: 'created', item_id: VALID_UUID },
      { status: 'created', item_id: VALID_UUID },
    ],
    error: null,
  }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
});

await check('19b. data ausente (null) -> error', async () => {
  setRpc(async () => ({ data: null, error: null }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
});

await check('19c. row com chave a mais -> error (hasExactKeys)', async () => {
  setRpc(async () => ({ data: [{ status: 'created', item_id: VALID_UUID, extra: 'x' }], error: null }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
});

// ============================================================================
// 20-25. AUDITORIA ESTÁTICA DO ARQUIVO-FONTE
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/local-task-execution.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

await check('20. ExecuteCreateLocalTaskInput não expõe userId/claims/client externo/deps', () => {
  // Não usa `[^}]*` simples: o campo `task` contém um objeto aninhado
  // (`{ actionType: 'create_local_task' }`), então a primeira `}` do tipo
  // é a daquele objeto interno, não o fechamento do tipo. Casa até a
  // linha que fecha o tipo (`};` sozinho na linha), como o arquivo real
  // formata.
  const typeMatch = codeOnly.match(/export type ExecuteCreateLocalTaskInput = \{(.*?)\n\};/s);
  assert.ok(typeMatch, 'tipo de input público não encontrado');
  const fields = typeMatch[1];
  assert.ok(!/userId/i.test(fields));
  assert.ok(!/claims/i.test(fields));
  assert.ok(!/supabase/i.test(fields));
  assert.ok(!/deps/i.test(fields));
  // Exatamente os 4 campos esperados, nenhum a mais.
  assert.ok(/expectedStateId\s*:\s*string/.test(fields));
  assert.ok(/proposalId\s*:\s*string/.test(fields));
  assert.ok(/task\s*:/.test(fields));
  assert.ok(/now\s*:\s*number/.test(fields));
});

await check('20b. chamada real à RPC nunca envia user_id como argumento', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', item_id: null }], error: null }));
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: FULL_TASK, now: NOW });
  const keys = Object.keys(calls[0].args);
  assert.ok(!keys.some((k) => /user/i.test(k)), `chave suspeita encontrada: ${keys.join(',')}`);
});

await check('21. nenhum admin/service_role no código real', () => {
  const forbidden = ['service_role', 'createAdminClient', 'SUPABASE_SECRET_KEY'];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

await check('22. nenhuma re-query após conflict (uma única chamada de rpc)', async () => {
  let rpcCalls = 0;
  setRpc(async () => {
    rpcCalls++;
    return { data: [{ status: 'conflict', item_id: null }], error: null };
  });
  await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.equal(rpcCalls, 1);
});

await check('23. nenhuma mutation extra — só .rpc( no código real', () => {
  const forbidden = ['.insert(', '.update(', '.delete('];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
  assert.ok(codeOnly.includes('.rpc('));
});

await check('24. nenhum Calendar/Anthropic/OpenAI no código real', () => {
  const forbidden = ['Calendar', 'Anthropic', 'OpenAI'];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

await check('25. proposal-turn.ts não é importado por este módulo', () => {
  assert.ok(!codeOnly.includes("from './proposal-turn'"));
  assert.ok(!codeOnly.includes('proposal-turn'));
});

await check('26. módulo é server-only', () => {
  assert.ok(codeOnly.includes("import 'server-only'"));
});

await check('27. reaproveita Extract<ProposedAction, ...>["task"], não duplica shape', () => {
  assert.ok(codeOnly.includes("from './proposed-action'"));
  assert.ok(codeOnly.includes("Extract<ProposedAction, { actionType: 'create_local_task' }>['task']"));
});

// ============================================================================
// 28. NOW INVÁLIDO / IDENTIFICADORES VAZIOS — validação de boundary, zero I/O
// ============================================================================

await check('28a. now = NaN -> error, zero chamada de rpc', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'created', item_id: VALID_UUID }], error: null }));
  const result = await executeCreateLocalTask({
    expectedStateId: 'state-1',
    proposalId: 'proposal-1',
    task: MINIMAL_TASK,
    now: NaN,
  });
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
});

await check('28b. now = Infinity -> error, zero chamada de rpc', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'created', item_id: VALID_UUID }], error: null }));
  const result = await executeCreateLocalTask({
    expectedStateId: 'state-1',
    proposalId: 'proposal-1',
    task: MINIMAL_TASK,
    now: Infinity,
  });
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
});

await check('28c. now não-inteiro -> error, zero chamada de rpc', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'created', item_id: VALID_UUID }], error: null }));
  const result = await executeCreateLocalTask({
    expectedStateId: 'state-1',
    proposalId: 'proposal-1',
    task: MINIMAL_TASK,
    now: NOW + 0.5,
  });
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
});

await check('29a. expectedStateId vazio -> error, zero chamada de rpc', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'created', item_id: VALID_UUID }], error: null }));
  const result = await executeCreateLocalTask({ expectedStateId: '', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
});

await check('29b. proposalId vazio -> error, zero chamada de rpc', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'created', item_id: VALID_UUID }], error: null }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: '', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
});

// ============================================================================
// 30. DATA + ERROR AO MESMO TEMPO — erro sempre vence
// ============================================================================

await check('30. data preenchido + error truthy -> error (erro vence, data nunca é lido)', async () => {
  setRpc(async () => ({
    data: [{ status: 'created', item_id: VALID_UUID }],
    error: { message: 'erro concorrente', code: 'xx000' },
  }));
  const result = await executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW });
  assert.deepEqual(result, { status: 'error' });
});

// ============================================================================
// 31. EXCEÇÃO NÃO CONTRATUAL — propaga, nunca vira {status:'error'} silencioso
// ============================================================================

await check('31. supabase.rpc lançando exceção propaga (rejeita), mesma convenção de runtime-state-storage.ts', async () => {
  setRpc(async () => {
    throw new Error('falha de rede inesperada, fora do contrato {data,error}');
  });
  await assert.rejects(
    () => executeCreateLocalTask({ expectedStateId: 'state-1', proposalId: 'proposal-1', task: MINIMAL_TASK, now: NOW }),
    /falha de rede inesperada/,
  );
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
