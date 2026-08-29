// Testes unitários de src/lib/conversation/proposal-turn.ts.
//
// Execução: npm run test:proposal-turn
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão de
// tests/security/rls.test.mjs e tests/conversation/conversation-turn.test.mjs.
//
// Importa o MÓDULO REAL, e através dele a Confirmation Policy REAL
// (`resolveProposalConfirmation`, de confirmation.ts) — nenhuma cópia do
// vocabulário/normalização/decisão confirmed-vs-cancelled é reimplementada
// aqui. A única peça substituída é `runtime-state-storage.ts`
// (getRuntimeState/consumeRuntimeState exigiriam Supabase real),
// via o mesmo dublê já usado por conversation-turn.test.mjs
// (tests/support/fake-runtime-state-storage.mjs), estendido com
// `consumeRuntimeState`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveProposalConversationalTurn } from '../../src/lib/conversation/proposal-turn.ts';
import { handlers as storageHandlers } from '../support/fake-runtime-state-storage.mjs';

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

function neverCalled(name) {
  return async (...args) => {
    throw new Error(`${name} não deveria ter sido chamado, foi chamado com ${JSON.stringify(args)}`);
  };
}

function setHandlers(overrides = {}) {
  storageHandlers.getRuntimeState = overrides.getRuntimeState ?? neverCalled('getRuntimeState');
  storageHandlers.replaceRuntimeState = overrides.replaceRuntimeState ?? neverCalled('replaceRuntimeState');
  storageHandlers.advanceRuntimeState = overrides.advanceRuntimeState ?? neverCalled('advanceRuntimeState');
  storageHandlers.consumeRuntimeState = overrides.consumeRuntimeState ?? neverCalled('consumeRuntimeState');
}

// --- Fixtures reais (nenhum dado pessoal) -----------------------------

const NOW = 1_000_000;
const PROPOSAL_EXPIRES_AT = NOW + 5 * 60_000;

function fixtureProposalState(expiresAt = PROPOSAL_EXPIRES_AT) {
  return {
    status: 'awaiting_confirmation',
    proposalId: 'fixture-proposal-id-999', // deliberadamente diferente de qualquer stateId usado nos testes
    action: {
      actionType: 'create_local_task',
      task: { title: 'Enviar relatório', description: null, deadline: null, duration: null },
    },
    createdAt: NOW,
    expiresAt,
  };
}

function fixtureConversationState() {
  return {
    status: 'awaiting_clarification',
    pendingIntent: {
      missingFields: [],
      confidence: 0.9,
      intentType: 'cancel_event',
      eventReference: { kind: 'existing_reference', raw: 'a reunião de amanhã', resolvedId: null },
      calendarAction: 'cancel',
    },
    currentQuestion: { field: 'event_reference', text: 'Qual tarefa ou compromisso você quer dizer?' },
    createdAt: NOW,
    expiresAt: PROPOSAL_EXPIRES_AT,
  };
}

function foundProposal(stateId, expiresAt) {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId, kind: 'proposal', state: fixtureProposalState(expiresAt) },
    }),
  });
}

// ============================================================================
// RUNTIME AUSENTE/EXPIRADO/ERRO
// ============================================================================

await check('1. runtime not_found -> no_active_runtime_state', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'no_active_runtime_state');
});

await check('2. runtime expired -> runtime_expired', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'expired' }) });
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'runtime_expired');
});

await check('3. runtime error -> error', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'error' }) });
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'error');
});

// ============================================================================
// FOUND CLARIFICATION (boundary espelhado de conversation-turn.ts)
// ============================================================================

await check('4. found clarification -> clarification_pending, zero write', async () => {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'clarif-1', kind: 'clarification', state: fixtureConversationState() },
    }),
  });
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'clarification_pending');
});

// ============================================================================
// FOUND PROPOSAL — dispatch da Confirmation Policy REAL
// ============================================================================

await check('5. found proposal + "talvez" (ambiguous) -> confirmation_ambiguous, zero consume', async () => {
  foundProposal('state-A', PROPOSAL_EXPIRES_AT);
  const result = await resolveProposalConversationalTurn('talvez', NOW);
  assert.equal(result.status, 'confirmation_ambiguous');
});

await check('6. found proposal + texto não reconhecido -> confirmation_unrecognized, zero consume', async () => {
  foundProposal('state-A', PROPOSAL_EXPIRES_AT);
  const result = await resolveProposalConversationalTurn('me explica melhor', NOW);
  assert.equal(result.status, 'confirmation_unrecognized');
});

await check('7. found proposal já expirada (defesa em profundidade da policy) -> runtime_expired, zero consume', async () => {
  foundProposal('state-A', NOW); // expiresAt === now: já expirada do ponto de vista da policy
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'runtime_expired');
});

await check('8. found proposal + "não" (cancelled) -> consume chamado exatamente uma vez', async () => {
  let consumeCalls = 0;
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'state-B', kind: 'proposal', state: fixtureProposalState() },
    }),
    consumeRuntimeState: async () => {
      consumeCalls++;
      return { status: 'consumed', value: { stateId: 'state-B', kind: 'proposal', state: fixtureProposalState() } };
    },
  });
  await resolveProposalConversationalTurn('não', NOW);
  assert.equal(consumeCalls, 1);
});

// ============================================================================
// RESULTADO DO CONSUME
// ============================================================================

await check('9. cancelled + consumed -> cancelled', async () => {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'state-C', kind: 'proposal', state: fixtureProposalState() },
    }),
    consumeRuntimeState: async () => ({
      status: 'consumed',
      value: { stateId: 'state-C', kind: 'proposal', state: fixtureProposalState() },
    }),
  });
  const result = await resolveProposalConversationalTurn('cancela', NOW);
  assert.equal(result.status, 'cancelled');
});

await check('10. cancelled + conflict -> conflict', async () => {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'state-D', kind: 'proposal', state: fixtureProposalState() },
    }),
    consumeRuntimeState: async () => ({ status: 'conflict' }),
  });
  const result = await resolveProposalConversationalTurn('cancela', NOW);
  assert.equal(result.status, 'conflict');
});

await check('11. cancelled + error -> error (nunca cancelled)', async () => {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'state-E', kind: 'proposal', state: fixtureProposalState() },
    }),
    consumeRuntimeState: async () => ({ status: 'error' }),
  });
  const result = await resolveProposalConversationalTurn('cancela', NOW);
  assert.equal(result.status, 'error');
  assert.notEqual(result.status, 'cancelled');
});

// ============================================================================
// CONFLICT — nenhuma correção automática
// ============================================================================

await check('12 e 14. conflict -> nenhuma segunda tentativa de consume, nenhuma re-query', async () => {
  let getCalls = 0;
  let consumeCalls = 0;
  setHandlers({
    getRuntimeState: async () => {
      getCalls++;
      return { status: 'found', value: { stateId: 'state-F', kind: 'proposal', state: fixtureProposalState() } };
    },
    consumeRuntimeState: async () => {
      consumeCalls++;
      return { status: 'conflict' };
    },
  });
  const result = await resolveProposalConversationalTurn('cancela', NOW);
  assert.equal(result.status, 'conflict');
  assert.equal(getCalls, 1);
  assert.equal(consumeCalls, 1);
});

await check('13. conflict -> nenhum fallback para replace', async () => {
  // replaceRuntimeState permanece "unconfigured" (lança) — se
  // proposal-turn.ts tentasse qualquer fallback, o teste falharia com uma
  // exceção não tratada em vez do `conflict` esperado.
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'state-G', kind: 'proposal', state: fixtureProposalState() },
    }),
    consumeRuntimeState: async () => ({ status: 'conflict' }),
  });
  const result = await resolveProposalConversationalTurn('cancela', NOW);
  assert.equal(result.status, 'conflict');
});

// ============================================================================
// stateId / proposalId
// ============================================================================

await check('15. stateId do GET é exatamente o expectedStateId usado no consume', async () => {
  let capturedStateId = null;
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'distinctive-state-id-777', kind: 'proposal', state: fixtureProposalState() },
    }),
    consumeRuntimeState: async (stateId) => {
      capturedStateId = stateId;
      return { status: 'consumed', value: { stateId, kind: 'proposal', state: fixtureProposalState() } };
    },
  });
  await resolveProposalConversationalTurn('cancela', NOW);
  assert.equal(capturedStateId, 'distinctive-state-id-777');
});

await check('16. proposalId nunca é usado como CAS', async () => {
  let capturedStateId = null;
  const proposal = fixtureProposalState();
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'state-H', kind: 'proposal', state: proposal },
    }),
    consumeRuntimeState: async (stateId) => {
      capturedStateId = stateId;
      return { status: 'consumed', value: { stateId, kind: 'proposal', state: proposal } };
    },
  });
  await resolveProposalConversationalTurn('cancela', NOW);
  assert.equal(capturedStateId, 'state-H');
  assert.notEqual(capturedStateId, proposal.proposalId);
});

// ============================================================================
// 17. REPLAY
// ============================================================================

await check('17. replay simulado: uma tentativa consumed, segunda conflict', async () => {
  let callCount = 0;
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'state-I', kind: 'proposal', state: fixtureProposalState() },
    }),
    consumeRuntimeState: async () => {
      callCount++;
      if (callCount === 1) {
        return { status: 'consumed', value: { stateId: 'state-I', kind: 'proposal', state: fixtureProposalState() } };
      }
      return { status: 'conflict' };
    },
  });
  const first = await resolveProposalConversationalTurn('cancela', NOW);
  const second = await resolveProposalConversationalTurn('cancela', NOW);
  assert.equal(first.status, 'cancelled');
  assert.equal(second.status, 'conflict');
});

// ============================================================================
// CONFIRMED — bloqueado
// ============================================================================

await check('18, 19 e 20. confirmed -> NÃO chama consume/advance/replace', async () => {
  // Todos os três handlers de mutação permanecem "unconfigured" (lançam).
  // Se proposal-turn.ts chamasse qualquer um deles no caminho `confirmed`,
  // o teste falharia com uma exceção em vez do status esperado.
  foundProposal('state-J', PROPOSAL_EXPIRES_AT);
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'confirmation_requires_execution');
});

await check('21. confirmed -> confirmation_requires_execution (boundary explícito)', async () => {
  foundProposal('state-K', PROPOSAL_EXPIRES_AT);
  const result = await resolveProposalConversationalTurn('confirma', NOW);
  assert.equal(result.status, 'confirmation_requires_execution');
});

// ============================================================================
// 22-24, 26. VERIFICAÇÃO ESTÁTICA DO ARQUIVO-FONTE
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/proposal-turn.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

await check('22, 23 e 24. nenhuma Execution/item/Calendar no código real', () => {
  const forbidden = [
    '.insert(',
    '.update(',
    '.delete(',
    'Calendar',
    'Anthropic',
    'OpenAI',
    'NextResponse',
    'service_role',
    'createAdminClient',
    'items',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

await check('25. API não recebe userId/stateId/proposalId externos', () => {
  const signatureMatch = codeOnly.match(/export async function resolveProposalConversationalTurn\(([^)]*)\)/);
  assert.ok(signatureMatch, 'assinatura da função pública não encontrada');
  const params = signatureMatch[1];
  assert.ok(!/userId/i.test(params));
  assert.ok(!/stateId/i.test(params));
  assert.ok(!/proposalId/i.test(params));
  assert.ok(!/claims/i.test(params));
});

await check('26. módulo é server-only', () => {
  assert.ok(codeOnly.includes("import 'server-only'"));
});

// ============================================================================
// 27. USA confirmation.ts REAL, NÃO UMA CÓPIA
// ============================================================================

await check('27a. importa resolveProposalConfirmation de ./confirmation (não reimplementa vocabulário)', () => {
  assert.ok(codeOnly.includes("from './confirmation'"));
  // Nenhum vocabulário duplicado: os literais reais de confirmation.ts
  // (ex.: "beleza", "deixa pra lá") não deveriam aparecer aqui como
  // strings de decisão — só nomes de status.
  assert.ok(!codeOnly.includes("'beleza'"));
  assert.ok(!codeOnly.includes("'deixa pra lá'"));
});

await check('27b. "certo" (excluído do vocabulário real de confirmation.ts) -> unrecognized, prova que a policy real decide', async () => {
  foundProposal('state-L', PROPOSAL_EXPIRES_AT);
  const result = await resolveProposalConversationalTurn('certo', NOW);
  // Se proposal-turn.ts tivesse uma cópia própria e mais permissiva do
  // vocabulário, "certo" poderia ser aceito como confirmação. A policy
  // real (confirmation.ts) exclui deliberadamente "certo" — o resultado
  // aqui só bate com isso se a policy real estiver de fato sendo usada.
  assert.equal(result.status, 'confirmation_unrecognized');
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
