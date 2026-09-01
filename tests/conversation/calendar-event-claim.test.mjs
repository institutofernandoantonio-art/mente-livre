// Testes unitários de src/lib/conversation/calendar-event-claim.ts.
//
// Execução: npm run test:calendar-event-claim
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão de
// tests/conversation/local-task-execution.test.mjs.
//
// A migration `claim_calendar_event_execution` NÃO foi aplicada no
// Supabase remoto — nenhum destes testes chama banco real. A única peça
// substituída é `../supabase/server` (createClient), via
// tests/support/fake-supabase-server.mjs, redirecionado só neste processo
// de teste (ver tests/support/ts-extension-loader.mjs). Estes testes
// provam o CONTRATO do wrapper TypeScript (chamada exata, validação
// defensiva do retorno) — nunca o comportamento transacional real da RPC
// em si, que só uma migration aplicada + banco real poderiam provar (ver
// tests/google/calendar-event-executions-migration.test.mjs para a
// auditoria estática do SQL, e o relatório desta subfase para o que
// permanece não comprovável sem Postgres real).
//
// CORREÇÃO DESTA SUBFASE: `now`/`p_now` foi removido inteiramente — a RPC
// não recebe mais tempo do chamador (usa now() do próprio Postgres, ver
// migration). Os testes antigos de conversão now->ISO e now inválido
// foram removidos por não terem mais nenhum parâmetro correspondente.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { claimCalendarEventExecution } from '../../src/lib/conversation/calendar-event-claim.ts';
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

const VALID_EVENT_ID = '123e4567e89b12d3a456426614174000';

function capturingRpc(responder) {
  const calls = [];
  setRpc(async (fn, args) => {
    calls.push({ fn, args });
    return responder(fn, args);
  });
  return calls;
}

// ============================================================================
// 1-3. CHAMADA EXATA DA RPC — nome, expectedStateId, proposalId
// ============================================================================

await check('1. chama exatamente "claim_calendar_event_execution"', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', google_event_id: null }], error: null }));
  await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'claim_calendar_event_execution');
});

await check('2. usa p_expected_state_id correto', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', google_event_id: null }], error: null }));
  await claimCalendarEventExecution({ expectedStateId: 'distinctive-state-id', proposalId: 'proposal-1' });
  assert.equal(calls[0].args.p_expected_state_id, 'distinctive-state-id');
});

await check('3. usa p_proposal_id correto', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', google_event_id: null }], error: null }));
  await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'distinctive-proposal-id' });
  assert.equal(calls[0].args.p_proposal_id, 'distinctive-proposal-id');
});

// ============================================================================
// 1-2 (seção "TESTES OBRIGATÓRIOS" desta subfase): RPC/wrapper NÃO aceitam
// nem enviam now/p_now
// ============================================================================

await check('4. wrapper NÃO aceita `now` no input — TypeClaimCalendarEventExecutionInput só tem expectedStateId/proposalId', () => {
  const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/calendar-event-claim.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const typeMatch = source.match(/export type ClaimCalendarEventExecutionInput = \{([\s\S]*?)\n\};/);
  assert.ok(typeMatch, 'tipo de input público não encontrado');
  const fields = typeMatch[1];
  assert.ok(!/\bnow\b/.test(fields), 'campo now não deveria existir mais');
  assert.ok(/expectedStateId\s*:\s*string/.test(fields));
  assert.ok(/proposalId\s*:\s*string/.test(fields));
});

await check('5. chamada real à RPC NUNCA envia p_now/now como argumento', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', google_event_id: null }], error: null }));
  await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  const keys = Object.keys(calls[0].args);
  assert.deepEqual(keys.sort(), ['p_expected_state_id', 'p_proposal_id']);
  assert.ok(!keys.some((k) => /now/i.test(k)), `chave suspeita encontrada: ${keys.join(',')}`);
});

await check('25. zero user_id como argumento — nenhuma chave suspeita enviada à RPC', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', google_event_id: null }], error: null }));
  await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  const keys = Object.keys(calls[0].args);
  assert.ok(!keys.some((k) => /user/i.test(k)), `chave suspeita encontrada: ${keys.join(',')}`);
});

await check('26. zero google_event_id como argumento — a RPC deriva sozinha, nunca aceita pronto', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict', google_event_id: null }], error: null }));
  await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  const keys = Object.keys(calls[0].args);
  assert.ok(!keys.some((k) => /google_event_id/i.test(k)), `chave suspeita encontrada: ${keys.join(',')}`);
});

// ============================================================================
// RESULTADOS VÁLIDOS
// ============================================================================

await check('claimed + id válido -> { status: claimed, googleEventId }', async () => {
  setRpc(async () => ({ data: [{ status: 'claimed', google_event_id: VALID_EVENT_ID }], error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'claimed', googleEventId: VALID_EVENT_ID });
});

await check('already_claimed + id válido -> { status: already_claimed, googleEventId } (retry idempotente)', async () => {
  setRpc(async () => ({ data: [{ status: 'already_claimed', google_event_id: VALID_EVENT_ID }], error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'already_claimed', googleEventId: VALID_EVENT_ID });
});

await check('conflict + google_event_id null -> { status: conflict }', async () => {
  setRpc(async () => ({ data: [{ status: 'conflict', google_event_id: null }], error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'conflict' });
});

// ============================================================================
// VALIDAÇÃO DEFENSIVA DO RETORNO — shape inválido -> error
// ============================================================================

await check('erro técnico do supabase.rpc -> error, nada vazado', async () => {
  setRpc(async () => ({ data: null, error: { message: 'segredo interno', code: '23505', details: 'x', hint: 'y' } }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
  assert.deepEqual(Object.keys(result), ['status']);
});

await check('status desconhecido -> error', async () => {
  setRpc(async () => ({ data: [{ status: 'quem-sabe', google_event_id: null }], error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('claimed sem google_event_id (null) -> error', async () => {
  setRpc(async () => ({ data: [{ status: 'claimed', google_event_id: null }], error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('claimed com google_event_id que não bate o formato (32 hex lowercase) -> error', async () => {
  for (const bad of ['NAO-E-UM-ID', VALID_EVENT_ID.toUpperCase(), VALID_EVENT_ID.slice(0, 31), VALID_EVENT_ID + 'z', '']) {
    setRpc(async () => ({ data: [{ status: 'claimed', google_event_id: bad }], error: null }));
    const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
    assert.deepEqual(result, { status: 'error' }, `deveria rejeitar: ${JSON.stringify(bad)}`);
  }
});

await check('already_claimed com google_event_id inválido -> error (mesma validação de claimed)', async () => {
  setRpc(async () => ({ data: [{ status: 'already_claimed', google_event_id: 'invalido' }], error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('conflict com google_event_id inesperado (não-null) -> error', async () => {
  setRpc(async () => ({ data: [{ status: 'conflict', google_event_id: VALID_EVENT_ID }], error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('array vazio -> error', async () => {
  setRpc(async () => ({ data: [], error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('múltiplas rows inesperadas -> error', async () => {
  setRpc(async () => ({
    data: [
      { status: 'claimed', google_event_id: VALID_EVENT_ID },
      { status: 'claimed', google_event_id: VALID_EVENT_ID },
    ],
    error: null,
  }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('data ausente (null) -> error', async () => {
  setRpc(async () => ({ data: null, error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('row com chave a mais -> error (hasExactKeys)', async () => {
  setRpc(async () => ({ data: [{ status: 'claimed', google_event_id: VALID_EVENT_ID, extra: 'x' }], error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

// ============================================================================
// AUDITORIA ESTÁTICA DO ARQUIVO-FONTE
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/calendar-event-claim.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

await check('nenhum admin/service_role no código real', () => {
  const forbidden = ['service_role', 'createAdminClient', 'SUPABASE_SECRET_KEY'];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

await check('nenhuma re-query após conflict (uma única chamada de rpc)', async () => {
  let rpcCalls = 0;
  setRpc(async () => {
    rpcCalls++;
    return { data: [{ status: 'conflict', google_event_id: null }], error: null };
  });
  await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.equal(rpcCalls, 1);
});

await check('nenhuma mutation extra — só .rpc( no código real', () => {
  const forbidden = ['.insert(', '.update(', '.delete('];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
  assert.ok(codeOnly.includes('.rpc('));
});

await check('zero import/chamada de Google/Anthropic/OpenAI no código real', () => {
  const forbidden = ['googleapis.com', 'Anthropic', 'OpenAI', "from '../google/calendar'", 'events.insert'];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

await check('21. proposal-turn.ts não importa este módulo ainda (wiring fora de escopo desta subfase)', () => {
  const proposalTurnPath = fileURLToPath(new URL('../../src/lib/conversation/proposal-turn.ts', import.meta.url));
  const proposalTurnCode = readFileSync(proposalTurnPath, 'utf8');
  assert.ok(!proposalTurnCode.includes('calendar-event-claim'));
  assert.ok(!proposalTurnCode.includes('claimCalendarEventExecution'));
});

await check(
  '22. cancelamento específico para create_calendar_event continua registrado como pré-requisito futuro (proposal-turn.ts nunca afirma o contrário)',
  () => {
    const proposalTurnPath = fileURLToPath(new URL('../../src/lib/conversation/proposal-turn.ts', import.meta.url));
    const proposalTurnCode = readFileSync(proposalTurnPath, 'utf8');
    // proposal-turn.ts continua tratando qualquer actionType diferente de
    // create_local_task (incluindo create_calendar_event) como o guard
    // defensivo já existente — nunca ganhou uma segunda lógica de
    // cancelamento nem uma alegação de que o claim resolve isso sozinho.
    assert.ok(!proposalTurnCode.includes('claim_calendar_event_execution'));
    assert.ok(!/linearizad[ao]/.test(proposalTurnCode));
  },
);

await check('25b. módulo é server-only', () => {
  assert.ok(codeOnly.includes("import 'server-only'"));
});

// ============================================================================
// IDENTIFICADORES VAZIOS — validação de boundary, zero I/O
// ============================================================================

await check('expectedStateId vazio -> error, zero chamada de rpc', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'claimed', google_event_id: VALID_EVENT_ID }], error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: '', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
});

await check('proposalId vazio -> error, zero chamada de rpc', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'claimed', google_event_id: VALID_EVENT_ID }], error: null }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: '' });
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
});

// ============================================================================
// DATA + ERROR AO MESMO TEMPO / EXCEÇÃO NÃO CONTRATUAL
// ============================================================================

await check('data preenchido + error truthy -> error (erro vence, data nunca é lido)', async () => {
  setRpc(async () => ({
    data: [{ status: 'claimed', google_event_id: VALID_EVENT_ID }],
    error: { message: 'erro concorrente', code: 'xx000' },
  }));
  const result = await claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('supabase.rpc lançando exceção propaga (rejeita), mesma convenção do resto da pilha', async () => {
  setRpc(async () => {
    throw new Error('falha de rede inesperada, fora do contrato {data,error}');
  });
  await assert.rejects(
    () => claimCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' }),
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
