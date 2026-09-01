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
// aqui. Duas peças são substituídas: `runtime-state-storage.ts`
// (getRuntimeState/consumeRuntimeState exigiriam Supabase real), via o
// mesmo dublê já usado por conversation-turn.test.mjs
// (tests/support/fake-runtime-state-storage.mjs); e
// `local-task-execution.ts` (executeCreateLocalTask exigiria Supabase
// real), via tests/support/fake-local-task-execution.mjs — ambos
// redirecionados só neste processo de teste (ver
// tests/support/ts-extension-loader.mjs), nunca alterando a forma como
// proposal-turn.ts importa essas dependências em produção.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveProposalConversationalTurn } from '../../src/lib/conversation/proposal-turn.ts';
import { handlers as storageHandlers } from '../support/fake-runtime-state-storage.mjs';
import { handlers as executorHandlers } from '../support/fake-local-task-execution.mjs';
import { handlers as cancelHandlers } from '../support/fake-calendar-event-cancel.mjs';

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
  executorHandlers.executeCreateLocalTask = overrides.executeCreateLocalTask ?? neverCalled('executeCreateLocalTask');
  cancelHandlers.cancelCalendarEventProposal =
    overrides.cancelCalendarEventProposal ?? neverCalled('cancelCalendarEventProposal');
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

const VALID_ITEM_UUID = '11111111-2222-4333-8444-555555555555';

function fixtureProposalStateWithTask(task, expiresAt = PROPOSAL_EXPIRES_AT) {
  return {
    status: 'awaiting_confirmation',
    proposalId: 'fixture-proposal-id-999',
    action: { actionType: 'create_local_task', task },
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
// CONFIRMED — executa via executeCreateLocalTask
// ============================================================================

const FULL_TASK = {
  title: 'Enviar relatório',
  description: 'Relatório mensal',
  deadline: { at: '2026-09-01T12:00:00.000Z', source: 'stated' },
  duration: { minutes: 30, source: 'inferred' },
};

function foundProposalWithTask(stateId, task, expiresAt = PROPOSAL_EXPIRES_AT) {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId, kind: 'proposal', state: fixtureProposalStateWithTask(task, expiresAt) },
    }),
  });
}

function capturingExecutor(responder) {
  const calls = [];
  executorHandlers.executeCreateLocalTask = async (input) => {
    calls.push(input);
    return responder(input);
  };
  return calls;
}

await check('18. confirmed chama o executor exatamente 1 vez', async () => {
  foundProposalWithTask('state-J', FULL_TASK);
  const calls = capturingExecutor(() => ({ status: 'created', itemId: VALID_ITEM_UUID }));
  await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(calls.length, 1);
});

await check('19. confirmed usa expectedStateId exato da leitura runtime', async () => {
  foundProposalWithTask('distinctive-state-id-999', FULL_TASK);
  const calls = capturingExecutor(() => ({ status: 'created', itemId: VALID_ITEM_UUID }));
  await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(calls[0].expectedStateId, 'distinctive-state-id-999');
});

await check('20. confirmed usa proposalId exato do ProposalState (nunca o stateId)', async () => {
  foundProposalWithTask('state-K', FULL_TASK);
  const calls = capturingExecutor(() => ({ status: 'created', itemId: VALID_ITEM_UUID }));
  await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(calls[0].proposalId, 'fixture-proposal-id-999');
  assert.notEqual(calls[0].proposalId, calls[0].expectedStateId);
});

await check('21. confirmed usa a task exata do ProposedAction persistido (mesma referência de valores)', async () => {
  foundProposalWithTask('state-L', FULL_TASK);
  const calls = capturingExecutor(() => ({ status: 'created', itemId: VALID_ITEM_UUID }));
  await resolveProposalConversationalTurn('sim', NOW);
  assert.deepEqual(calls[0].task, FULL_TASK);
});

await check('22. confirmed usa o mesmo now recebido pela função (nenhum Date.now() interno)', async () => {
  foundProposalWithTask('state-M', FULL_TASK);
  const calls = capturingExecutor(() => ({ status: 'created', itemId: VALID_ITEM_UUID }));
  const distinctiveNow = NOW + 1234; // ainda dentro da janela de validade da proposta (< PROPOSAL_EXPIRES_AT)
  await resolveProposalConversationalTurn('sim', distinctiveNow);
  assert.equal(calls[0].now, distinctiveNow);
});

await check('23. executor recebe SOMENTE {expectedStateId,proposalId,task,now} — nada externo', async () => {
  foundProposalWithTask('state-N', FULL_TASK);
  const calls = capturingExecutor(() => ({ status: 'created', itemId: VALID_ITEM_UUID }));
  await resolveProposalConversationalTurn('sim', NOW);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['expectedStateId', 'now', 'proposalId', 'task']);
});

await check('24. created -> confirmed', async () => {
  foundProposalWithTask('state-O', FULL_TASK);
  capturingExecutor(() => ({ status: 'created', itemId: VALID_ITEM_UUID }));
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'confirmed');
});

await check('25. created retorna o itemId exato devolvido pelo executor', async () => {
  foundProposalWithTask('state-P', FULL_TASK);
  capturingExecutor(() => ({ status: 'created', itemId: VALID_ITEM_UUID }));
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.deepEqual(result, { status: 'confirmed', itemId: VALID_ITEM_UUID });
});

await check('26. conflict do executor -> conflict', async () => {
  foundProposalWithTask('state-Q', FULL_TASK);
  capturingExecutor(() => ({ status: 'conflict' }));
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.deepEqual(result, { status: 'conflict' });
});

await check('27. error do executor -> error', async () => {
  foundProposalWithTask('state-R', FULL_TASK);
  capturingExecutor(() => ({ status: 'error' }));
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.deepEqual(result, { status: 'error' });
});

await check('28. executor lançando exceção propaga (rejeita), mesma convenção do resto do módulo', async () => {
  foundProposalWithTask('state-S', FULL_TASK);
  executorHandlers.executeCreateLocalTask = async () => {
    throw new Error('falha inesperada fora do contrato de retorno');
  };
  await assert.rejects(
    () => resolveProposalConversationalTurn('sim', NOW),
    /falha inesperada fora do contrato de retorno/,
  );
});

await check('29. confirmed NÃO chama consumeRuntimeState', async () => {
  // consumeRuntimeState permanece "neverCalled" (setHandlers/foundProposalWithTask
  // não o sobrescrevem) — se proposal-turn.ts o chamasse no caminho
  // `confirmed`, o teste falharia com uma exceção em vez do status
  // esperado. Checkpoint crítico: a RPC atômica já remove a runtime row —
  // um segundo consume aqui quebraria a garantia de atomicidade.
  foundProposalWithTask('state-T', FULL_TASK);
  capturingExecutor(() => ({ status: 'created', itemId: VALID_ITEM_UUID }));
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'confirmed');
});

await check('30 e 31. confirmed NÃO chama advanceRuntimeState nem replaceRuntimeState', async () => {
  // Ambos permanecem "neverCalled" por padrão de setHandlers — mesma
  // lógica do teste anterior.
  foundProposalWithTask('state-U', FULL_TASK);
  capturingExecutor(() => ({ status: 'created', itemId: VALID_ITEM_UUID }));
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'confirmed');
});

await check('32. conflict (confirmed) NÃO faz re-query (getRuntimeState chamado 1 vez)', async () => {
  let getCalls = 0;
  setHandlers({
    getRuntimeState: async () => {
      getCalls++;
      return {
        status: 'found',
        value: { stateId: 'state-V', kind: 'proposal', state: fixtureProposalStateWithTask(FULL_TASK) },
      };
    },
    executeCreateLocalTask: async () => ({ status: 'conflict' }),
  });
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'conflict');
  assert.equal(getCalls, 1);
});

await check('33. error (confirmed) NÃO faz re-query (getRuntimeState chamado 1 vez)', async () => {
  let getCalls = 0;
  setHandlers({
    getRuntimeState: async () => {
      getCalls++;
      return {
        status: 'found',
        value: { stateId: 'state-W', kind: 'proposal', state: fixtureProposalStateWithTask(FULL_TASK) },
      };
    },
    executeCreateLocalTask: async () => ({ status: 'error' }),
  });
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'error');
  assert.equal(getCalls, 1);
});

await check('34. ambiguous NÃO chama o executor', async () => {
  foundProposalWithTask('state-X', FULL_TASK);
  const result = await resolveProposalConversationalTurn('talvez', NOW);
  assert.equal(result.status, 'confirmation_ambiguous');
});

await check('35. unrecognized NÃO chama o executor', async () => {
  foundProposalWithTask('state-Y', FULL_TASK);
  const result = await resolveProposalConversationalTurn('me explica melhor', NOW);
  assert.equal(result.status, 'confirmation_unrecognized');
});

await check('36. proposta expirada (policy) NÃO chama o executor', async () => {
  foundProposalWithTask('state-Z', FULL_TASK, NOW); // expiresAt === now
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'runtime_expired');
});

await check('37. clarification_pending NÃO chama o executor', async () => {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'clarif-2', kind: 'clarification', state: fixtureConversationState() },
    }),
  });
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'clarification_pending');
});

await check('38. runtime not_found NÃO chama o executor', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'no_active_runtime_state');
});

await check('39. runtime error NÃO chama o executor', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'error' }) });
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'error');
});

await check('40. actionType não suportada (defensivo, hoje inalcançável) -> error, zero executor', async () => {
  // ProposedAction real só tem `create_local_task` — este fixture usa um
  // actionType arbitrário só para exercitar o guard defensivo descrito no
  // cabeçalho de proposal-turn.ts. Testável só porque este arquivo é JS
  // puro (sem checagem de tipos); em TypeScript real este branch é
  // inalcançável hoje.
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: {
        stateId: 'state-AA',
        kind: 'proposal',
        state: {
          status: 'awaiting_confirmation',
          proposalId: 'proposal-unsupported',
          action: { actionType: 'create_calendar_event', task: FULL_TASK },
          createdAt: NOW,
          expiresAt: PROPOSAL_EXPIRES_AT,
        },
      },
    }),
  });
  const result = await resolveProposalConversationalTurn('sim', NOW);
  assert.equal(result.status, 'error');
});

// ============================================================================
// 41. TESTE DE REPLAY LÓGICO — confirmação bem-sucedida não executa 2x
// ============================================================================

await check('41. replay: primeira chamada confirmed, segunda vê runtime ausente (RPC já consumiu)', async () => {
  let getCallCount = 0;
  let executorCallCount = 0;
  setHandlers({
    getRuntimeState: async () => {
      getCallCount++;
      if (getCallCount === 1) {
        return {
          status: 'found',
          value: { stateId: 'state-BB', kind: 'proposal', state: fixtureProposalStateWithTask(FULL_TASK) },
        };
      }
      // Segunda leitura: a RPC atômica já removeu a runtime row junto com
      // a criação do item — nenhuma simulação de banco real necessária,
      // só o fake refletindo o estado pós-commit esperado.
      return { status: 'not_found' };
    },
    executeCreateLocalTask: async () => {
      executorCallCount++;
      return { status: 'created', itemId: VALID_ITEM_UUID };
    },
  });

  const first = await resolveProposalConversationalTurn('sim', NOW);
  const second = await resolveProposalConversationalTurn('sim', NOW);

  assert.deepEqual(first, { status: 'confirmed', itemId: VALID_ITEM_UUID });
  assert.equal(second.status, 'no_active_runtime_state');
  assert.equal(executorCallCount, 1);
});

// ============================================================================
// SUBFASE 5 — cancelamento protegido de proposta de evento
// (create_calendar_event usa cancelCalendarEventProposal, nunca
// consumeRuntimeState; create_local_task continua exatamente como antes)
// ============================================================================

function fixtureCalendarProposalState(expiresAt = PROPOSAL_EXPIRES_AT) {
  return {
    status: 'awaiting_confirmation',
    proposalId: 'fixture-calendar-proposal-id-777',
    action: {
      actionType: 'create_calendar_event',
      event: {
        title: 'Reunião com o time',
        description: null,
        start: '2026-09-02T14:00:00.000Z',
        end: '2026-09-02T14:30:00.000Z',
        timezone: 'America/Sao_Paulo',
        reminderMinutesBeforeStart: 30,
      },
    },
    createdAt: NOW,
    expiresAt,
  };
}

function foundCalendarProposal(stateId, expiresAt) {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId, kind: 'proposal', state: fixtureCalendarProposalState(expiresAt) },
    }),
  });
}

function capturingCancel(responder) {
  const calls = [];
  cancelHandlers.cancelCalendarEventProposal = async (input) => {
    calls.push(input);
    return responder(input);
  };
  return calls;
}

await check(
  '42 (S5-35). create_local_task + "não" continua usando consumeRuntimeState — cancelCalendarEventProposal nunca chamado',
  async () => {
    // cancelCalendarEventProposal permanece "neverCalled" por padrão de
    // setHandlers (não sobrescrito por foundProposal) — se
    // proposal-turn.ts o chamasse para create_local_task, este teste
    // falharia com uma exceção em vez do `cancelled` esperado.
    setHandlers({
      getRuntimeState: async () => ({
        status: 'found',
        value: { stateId: 'state-local-cancel', kind: 'proposal', state: fixtureProposalState() },
      }),
      consumeRuntimeState: async () => ({
        status: 'consumed',
        value: { stateId: 'state-local-cancel', kind: 'proposal', state: fixtureProposalState() },
      }),
    });
    const result = await resolveProposalConversationalTurn('não', NOW);
    assert.equal(result.status, 'cancelled');
  },
);

await check(
  '43 (S5-36). create_calendar_event + "não" usa cancelCalendarEventProposal exatamente 1 vez — consumeRuntimeState nunca chamado',
  async () => {
    // consumeRuntimeState permanece "neverCalled" — se proposal-turn.ts o
    // chamasse para create_calendar_event, este teste falharia com uma
    // exceção em vez do `cancelled` esperado.
    foundCalendarProposal('state-cal-A', PROPOSAL_EXPIRES_AT);
    const calls = capturingCancel(() => ({ status: 'cancelled' }));
    const result = await resolveProposalConversationalTurn('não', NOW);
    assert.equal(calls.length, 1);
    assert.equal(result.status, 'cancelled');
  },
);

await check('44 (S5-36b). cancelCalendarEventProposal recebe expectedStateId/proposalId exatos, nada mais', async () => {
  foundCalendarProposal('distinctive-cal-state-id', PROPOSAL_EXPIRES_AT);
  const calls = capturingCancel(() => ({ status: 'cancelled' }));
  await resolveProposalConversationalTurn('cancela', NOW);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['expectedStateId', 'proposalId']);
  assert.equal(calls[0].expectedStateId, 'distinctive-cal-state-id');
  assert.equal(calls[0].proposalId, 'fixture-calendar-proposal-id-777');
});

await check('45 (S5-37). create_calendar_event + cancelled -> cancelled', async () => {
  foundCalendarProposal('state-cal-B', PROPOSAL_EXPIRES_AT);
  capturingCancel(() => ({ status: 'cancelled' }));
  const result = await resolveProposalConversationalTurn('não', NOW);
  assert.deepEqual(result, { status: 'cancelled' });
});

await check(
  '46 (S5-38 e S5-39). create_calendar_event + execution_started -> execution_started (NUNCA cancelled)',
  async () => {
    foundCalendarProposal('state-cal-C', PROPOSAL_EXPIRES_AT);
    capturingCancel(() => ({ status: 'execution_started' }));
    const result = await resolveProposalConversationalTurn('não', NOW);
    assert.deepEqual(result, { status: 'execution_started' });
    assert.notEqual(result.status, 'cancelled');
  },
);

await check('47 (S5-40). create_calendar_event + conflict -> conflict', async () => {
  foundCalendarProposal('state-cal-D', PROPOSAL_EXPIRES_AT);
  capturingCancel(() => ({ status: 'conflict' }));
  const result = await resolveProposalConversationalTurn('não', NOW);
  assert.deepEqual(result, { status: 'conflict' });
});

await check('48 (S5-41). create_calendar_event + error -> error', async () => {
  foundCalendarProposal('state-cal-E', PROPOSAL_EXPIRES_AT);
  capturingCancel(() => ({ status: 'error' }));
  const result = await resolveProposalConversationalTurn('não', NOW);
  assert.deepEqual(result, { status: 'error' });
});

await check('49. cancelCalendarEventProposal lançando exceção propaga (rejeita), mesma convenção do resto do módulo', async () => {
  foundCalendarProposal('state-cal-F', PROPOSAL_EXPIRES_AT);
  cancelHandlers.cancelCalendarEventProposal = async () => {
    throw new Error('falha inesperada fora do contrato de retorno');
  };
  await assert.rejects(
    () => resolveProposalConversationalTurn('não', NOW),
    /falha inesperada fora do contrato de retorno/,
  );
});

await check(
  '50 (S5-42). ramo "sim" (confirmado) de create_calendar_event continua sem claim/finalize/Google write nesta subfase — ainda retorna error',
  async () => {
    // Mesmo guard defensivo já testado no teste 40 (actionType não
    // suportada no caminho `confirmed`) — reafirmado explicitamente aqui
    // como regressão da Subfase 5: o lifecycle positivo não foi tocado.
    foundCalendarProposal('state-cal-G', PROPOSAL_EXPIRES_AT);
    const result = await resolveProposalConversationalTurn('sim', NOW);
    assert.equal(result.status, 'error');
  },
);

// ============================================================================
// 22-24, 26. VERIFICAÇÃO ESTÁTICA DO ARQUIVO-FONTE
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/proposal-turn.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

// Nota histórica: até a Subfase 4, este teste bania o token genérico
// 'Calendar' inteiro — válido enquanto proposal-turn.ts nunca tinha
// nenhum motivo legítimo para mencioná-lo. A Subfase 5 (cancelamento
// protegido de proposta de evento) autoriza explicitamente importar
// `cancelCalendarEventProposal`/`./calendar-event-cancel` — um ban
// genérico de 'Calendar' teria um falso positivo nesse identificador. A
// proteção real que importava (zero Calendar WRITE, zero claim/finalize
// chamados daqui) é preservada por checagens precisas abaixo, nunca
// enfraquecida.
await check('22, 23 e 24. nenhuma Execution direta/item/admin/timestamp/id gerado no código real', () => {
  const forbidden = [
    '.insert(',
    '.update(',
    '.delete(',
    "from('items')",
    'Anthropic',
    'OpenAI',
    'NextResponse',
    'service_role',
    'createAdminClient',
    'SUPABASE_SECRET_KEY',
    'items',
    'supabase',
    'Date.now(',
    'crypto.randomUUID(',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

await check(
  '22b. zero Calendar WRITE e zero claim/finalize chamados a partir de proposal-turn.ts (Subfase 5: só cancelamento protegido)',
  () => {
    const forbidden = [
      'googleapis.com',
      'events.insert',
      'access_token',
      'refresh_token',
      "from '../google/calendar'",
      'claimCalendarEventExecution',
      'finalizeCalendarEventExecution',
      'claim_calendar_event_execution',
      'finalize_calendar_event_execution',
    ];
    for (const token of forbidden) {
      assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
    }
  },
);

await check(
  '22c. usa a abstração ./calendar-event-cancel para o cancelamento de create_calendar_event, nunca a RPC/Supabase diretamente',
  () => {
    assert.ok(codeOnly.includes("from './calendar-event-cancel'"));
    assert.ok(codeOnly.includes('cancelCalendarEventProposal('));
    assert.ok(!codeOnly.includes('cancel_calendar_event_proposal'));
  },
);

await check('26b. confirmation_requires_execution não existe mais no código real', () => {
  assert.ok(!codeOnly.includes('confirmation_requires_execution'));
});

await check('26c. usa a abstração ./local-task-execution, nunca a RPC/Supabase diretamente', () => {
  assert.ok(codeOnly.includes("from './local-task-execution'"));
  assert.ok(codeOnly.includes('executeCreateLocalTask('));
  assert.ok(!codeOnly.includes('confirm_create_local_task'));
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
