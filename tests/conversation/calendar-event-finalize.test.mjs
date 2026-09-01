// Testes unitários de src/lib/conversation/calendar-event-finalize.ts.
//
// Execução: npm run test:calendar-event-finalize
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão de
// tests/conversation/calendar-event-claim.test.mjs.
//
// A migration `finalize_calendar_event_execution` NÃO foi aplicada no
// Supabase remoto — nenhum destes testes chama banco real. A única peça
// substituída é `../supabase/server` (createClient), via
// tests/support/fake-supabase-server.mjs, redirecionado só neste processo
// de teste (ver tests/support/ts-extension-loader.mjs). Estes testes
// provam o CONTRATO do wrapper TypeScript (chamada exata, validação
// defensiva do retorno) — nunca o comportamento transacional real da RPC
// em si (atomicidade/concorrência de verdade), que só uma migration
// aplicada + banco real poderiam provar (ver
// tests/google/finalize-calendar-event-execution-migration.test.mjs para
// a auditoria estática do SQL, e o relatório desta subfase para o que
// permanece não comprovável sem Postgres real).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { finalizeCalendarEventExecution } from '../../src/lib/conversation/calendar-event-finalize.ts';
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

await check('1. chama exatamente "finalize_calendar_event_execution"', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict' }], error: null }));
  await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, 'finalize_calendar_event_execution');
});

await check('2. usa p_expected_state_id correto', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict' }], error: null }));
  await finalizeCalendarEventExecution({ expectedStateId: 'distinctive-state-id', proposalId: 'proposal-1' });
  assert.equal(calls[0].args.p_expected_state_id, 'distinctive-state-id');
});

await check('3. usa p_proposal_id correto', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict' }], error: null }));
  await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'distinctive-proposal-id' });
  assert.equal(calls[0].args.p_proposal_id, 'distinctive-proposal-id');
});

// ============================================================================
// 4-6. Wrapper/RPC NUNCA enviam now/p_now/user_id/google_event_id/payload
// ============================================================================

await check('4. wrapper NÃO aceita `now` no input — FinalizeCalendarEventExecutionInput só tem expectedStateId/proposalId', () => {
  const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/calendar-event-finalize.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const typeMatch = source.match(/export type FinalizeCalendarEventExecutionInput = \{([\s\S]*?)\n\};/);
  assert.ok(typeMatch, 'tipo de input público não encontrado');
  const fields = typeMatch[1];
  assert.ok(!/\bnow\b/.test(fields), 'campo now não deveria existir');
  assert.ok(/expectedStateId\s*:\s*string/.test(fields));
  assert.ok(/proposalId\s*:\s*string/.test(fields));
});

await check('5. chamada real à RPC envia SOMENTE p_expected_state_id/p_proposal_id — nunca p_now/user/google_event_id/payload', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'conflict' }], error: null }));
  await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  const keys = Object.keys(calls[0].args);
  assert.deepEqual(keys.sort(), ['p_expected_state_id', 'p_proposal_id']);
  assert.ok(!keys.some((k) => /now/i.test(k)), `chave suspeita encontrada: ${keys.join(',')}`);
  assert.ok(!keys.some((k) => /user/i.test(k)), `chave suspeita encontrada: ${keys.join(',')}`);
  assert.ok(!keys.some((k) => /google_event_id/i.test(k)), `chave suspeita encontrada: ${keys.join(',')}`);
  assert.ok(!keys.some((k) => /payload/i.test(k)), `chave suspeita encontrada: ${keys.join(',')}`);
  assert.ok(!keys.some((k) => /token/i.test(k)), `chave suspeita encontrada: ${keys.join(',')}`);
});

await check('6. nenhuma re-query após conflict (uma única chamada de rpc)', async () => {
  let rpcCalls = 0;
  setRpc(async () => {
    rpcCalls++;
    return { data: [{ status: 'conflict' }], error: null };
  });
  await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.equal(rpcCalls, 1);
});

// ============================================================================
// RESULTADOS VÁLIDOS
// ============================================================================

await check('completed -> { status: completed }', async () => {
  setRpc(async () => ({ data: [{ status: 'completed' }], error: null }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'completed' });
});

await check('already_completed -> { status: already_completed } (retry idempotente de resposta perdida)', async () => {
  setRpc(async () => ({ data: [{ status: 'already_completed' }], error: null }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'already_completed' });
});

await check('conflict -> { status: conflict }', async () => {
  setRpc(async () => ({ data: [{ status: 'conflict' }], error: null }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'conflict' });
});

// ============================================================================
// VALIDAÇÃO DEFENSIVA DO RETORNO — shape inválido -> error
// ============================================================================

await check('erro técnico do supabase.rpc -> error, nada vazado', async () => {
  setRpc(async () => ({ data: null, error: { message: 'segredo interno', code: '23505', details: 'x', hint: 'y' } }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
  assert.deepEqual(Object.keys(result), ['status']);
});

await check('status desconhecido -> error', async () => {
  setRpc(async () => ({ data: [{ status: 'quem-sabe' }], error: null }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('row com chave a mais (ex.: google_event_id vazado) -> error (hasExactKeys)', async () => {
  setRpc(async () => ({ data: [{ status: 'completed', google_event_id: 'x' }], error: null }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('array vazio -> error', async () => {
  setRpc(async () => ({ data: [], error: null }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('múltiplas rows inesperadas -> error', async () => {
  setRpc(async () => ({
    data: [{ status: 'completed' }, { status: 'completed' }],
    error: null,
  }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('data ausente (null) -> error', async () => {
  setRpc(async () => ({ data: null, error: null }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('data não é array (objeto solto) -> error', async () => {
  setRpc(async () => ({ data: { status: 'completed' }, error: null }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

// ============================================================================
// AUDITORIA ESTÁTICA DO ARQUIVO-FONTE
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/calendar-event-finalize.ts', import.meta.url));
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

await check('módulo é server-only', () => {
  assert.ok(codeOnly.includes("import 'server-only'"));
});

await check('proposal-turn.ts não importa este módulo ainda (wiring fora de escopo desta subfase)', () => {
  const proposalTurnPath = fileURLToPath(new URL('../../src/lib/conversation/proposal-turn.ts', import.meta.url));
  const proposalTurnCode = readFileSync(proposalTurnPath, 'utf8');
  assert.ok(!proposalTurnCode.includes('calendar-event-finalize'));
  assert.ok(!proposalTurnCode.includes('finalizeCalendarEventExecution'));
});

await check('cancelamento específico para create_calendar_event continua registrado como pré-requisito futuro (proposal-turn.ts nunca afirma o contrário)', () => {
  const proposalTurnPath = fileURLToPath(new URL('../../src/lib/conversation/proposal-turn.ts', import.meta.url));
  const proposalTurnCode = readFileSync(proposalTurnPath, 'utf8');
  assert.ok(!proposalTurnCode.includes('finalize_calendar_event_execution'));
  assert.ok(!/linearizad[ao]/.test(proposalTurnCode));
});

await check('conversation-turn.ts não foi tocado por este módulo (zero import de calendar-event-finalize)', () => {
  const conversationTurnPath = fileURLToPath(new URL('../../src/lib/conversation/conversation-turn.ts', import.meta.url));
  const conversationTurnCode = readFileSync(conversationTurnPath, 'utf8');
  assert.ok(!conversationTurnCode.includes('calendar-event-finalize'));
  assert.ok(!conversationTurnCode.includes('finalizeCalendarEventExecution'));
});

// ============================================================================
// IDENTIFICADORES VAZIOS — validação de boundary, zero I/O
// ============================================================================

await check('expectedStateId vazio -> error, zero chamada de rpc', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'completed' }], error: null }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: '', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
});

await check('proposalId vazio -> error, zero chamada de rpc', async () => {
  const calls = capturingRpc(() => ({ data: [{ status: 'completed' }], error: null }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: '' });
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
});

// ============================================================================
// DATA + ERROR AO MESMO TEMPO / EXCEÇÃO NÃO CONTRATUAL
// ============================================================================

await check('data preenchido + error truthy -> error (erro vence, data nunca é lido)', async () => {
  setRpc(async () => ({
    data: [{ status: 'completed' }],
    error: { message: 'erro concorrente', code: 'xx000' },
  }));
  const result = await finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' });
  assert.deepEqual(result, { status: 'error' });
});

await check('supabase.rpc lançando exceção propaga (rejeita), mesma convenção do resto da pilha', async () => {
  setRpc(async () => {
    throw new Error('falha de rede inesperada, fora do contrato {data,error}');
  });
  await assert.rejects(
    () => finalizeCalendarEventExecution({ expectedStateId: 'state-1', proposalId: 'proposal-1' }),
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
