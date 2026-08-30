// Testes unitários de src/lib/conversation/conversation-turn.ts.
//
// Execução: npm run test:conversation-turn
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão de
// tests/security/rls.test.mjs: script node plano, record(name, pass),
// resumo final, exit code != 0 se algo falhar.
//
// Importa o MÓDULO REAL (nenhuma cópia/duplicação de lógica), com a API
// pública de produção exata (`intent, now, expirations` / `answer, now,
// expirations`, onde `expirations` é `{clarificationExpiresAt,
// proposalExpiresAt}` — nenhum parâmetro extra). As únicas peças substituídas
// são as quatro funções impuras que o arquivo real importa estaticamente
// de `./runtime-state-storage`/`./orchestration` — substituídas por
// dublês via o hook de resolução em tests/support/ (getRuntimeState/
// replaceRuntimeState/advanceRuntimeState exigiriam Supabase real;
// resolveClarificationTurn já é testada em sua própria subfase — aqui
// controlamos só o que ela DEVOLVE, nunca reimplementamos sua lógica).
//
// `readFileSync` no final confirma, por inspeção do arquivo-fonte real,
// que nenhum caminho do módulo referencia código de Execution.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  resolveFirstConversationalTurn,
  resolveClarificationConversationalTurn,
} from '../../src/lib/conversation/conversation-turn.ts';
import { handlers as storageHandlers } from '../support/fake-runtime-state-storage.mjs';
import { handlers as orchestrationHandlers } from '../support/fake-orchestration.mjs';

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

// Reconfigura os dublês antes de cada teste — nunca deixa handler de um
// teste anterior vazar para o próximo.
function setHandlers(overrides = {}) {
  storageHandlers.getRuntimeState = overrides.getRuntimeState ?? neverCalled('getRuntimeState');
  storageHandlers.replaceRuntimeState = overrides.replaceRuntimeState ?? neverCalled('replaceRuntimeState');
  storageHandlers.advanceRuntimeState = overrides.advanceRuntimeState ?? neverCalled('advanceRuntimeState');
  orchestrationHandlers.resolveClarificationTurn =
    overrides.resolveClarificationTurn ?? neverCalled('resolveClarificationTurn');
}

// --- Fixtures reais (nenhum dado pessoal) -----------------------------

const NOW = 1_000_000;
// Expiração de um state JÁ ARMAZENADO usada só dentro dos fixtures abaixo
// (fixtureConversationState/fixtureProposalState) — conceito diferente das
// expirações passadas como ARGUMENTO nas chamadas às funções reais.
const EXPIRES_AT = NOW + 5 * 60_000;

// Expirações distintas (A !== B) passadas como argumento em TODAS as
// chamadas a resolveFirstConversationalTurn/resolveClarificationConversationalTurn
// — deliberadamente diferentes uma da outra (espelhando a política real:
// 24h para clarificação, 30min para proposta) para que qualquer regressão
// que volte a usar um único timestamp para os dois campos seja detectada
// pelos testes (ver 24 e 25).
const CLARIFICATION_EXPIRES_AT = NOW + 24 * 60 * 60 * 1000; // A
const PROPOSAL_EXPIRES_AT = NOW + 30 * 60 * 1000; // B
const EXPIRATIONS = {
  clarificationExpiresAt: CLARIFICATION_EXPIRES_AT,
  proposalExpiresAt: PROPOSAL_EXPIRES_AT,
};

const needsClarificationIntent = {
  missingFields: [],
  confidence: 0.9,
  intentType: 'cancel_event',
  eventReference: { kind: 'existing_reference', raw: 'a reunião de amanhã', resolvedId: null },
  calendarAction: 'cancel',
};

const readyProposableIntent = {
  missingFields: [],
  confidence: 0.9,
  intentType: 'create_task',
  task: { kind: 'new_task', title: 'Enviar relatório', description: null },
  temporalWindow: null,
  duration: { source: 'stated', value: { minutes: 30 }, confidence: 1 },
  deadline: null,
};

const readyUnsupportedIntent = {
  missingFields: [],
  confidence: 0.9,
  intentType: 'conversational_question',
  question: 'Como funciona isso?',
};

const readyNotMaterializableIntent = {
  missingFields: [],
  confidence: 0.9,
  intentType: 'create_task',
  task: { kind: 'new_task', title: 'Organizar mudança', description: null },
  temporalWindow: { expression: 'algum dia', resolved: { kind: 'unresolved' } },
  duration: null,
  deadline: null,
};

function fixtureConversationState(currentQuestion) {
  return {
    status: 'awaiting_clarification',
    pendingIntent: needsClarificationIntent,
    currentQuestion,
    createdAt: NOW,
    expiresAt: EXPIRES_AT,
  };
}

function fixtureProposalState() {
  return {
    status: 'awaiting_confirmation',
    proposalId: 'fixture-proposal-id',
    action: {
      actionType: 'create_local_task',
      task: { title: 'x', description: null, deadline: null, duration: null },
    },
    createdAt: NOW,
    expiresAt: EXPIRES_AT,
  };
}

function foundClarification(stateId, orchestrationResult) {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId, kind: 'clarification', state: fixtureConversationState({ field: 'duration', text: 'x' }) },
    }),
    resolveClarificationTurn: async () => orchestrationResult,
  });
}

// ============================================================================
// PRIMEIRO TURNO
// ============================================================================

await check('1. primeiro turno -> clarification -> replace saved', async () => {
  let replaceCalls = 0;
  let capturedNext = null;
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    replaceRuntimeState: async (next) => {
      replaceCalls++;
      capturedNext = next;
      return { status: 'saved', value: { stateId: 'new-id', kind: next.kind, state: next.state } };
    },
  });

  const result = await resolveFirstConversationalTurn(needsClarificationIntent, NOW, EXPIRATIONS);

  assert.equal(result.status, 'clarification_saved');
  assert.equal(replaceCalls, 1);
  assert.equal(capturedNext.kind, 'clarification');
  assert.equal(capturedNext.state.status, 'awaiting_clarification');
  // A `question` do resultado deve vir EXATAMENTE da ConversationState
  // recém-criada (needsClarificationIntent é cancel_event sem
  // eventReference resolvida -> campo pendente é 'event_reference').
  assert.equal(result.question, capturedNext.state.currentQuestion.text);
  assert.equal(result.question, 'Qual tarefa ou compromisso você quer dizer?');
});

await check('1e. primeiro turno clarification: nenhum campo externo (stateId/userId/field) vaza no resultado', async () => {
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    replaceRuntimeState: async (next) => ({
      status: 'saved',
      value: { stateId: 'new-id', kind: next.kind, state: next.state },
    }),
  });

  const result = await resolveFirstConversationalTurn(needsClarificationIntent, NOW, EXPIRATIONS);

  assert.deepEqual(Object.keys(result).sort(), ['question', 'status']);
});

await check('1f. primeiro turno clarification: replace falha -> error, sem question', async () => {
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    replaceRuntimeState: async () => ({ status: 'error' }),
  });

  const result = await resolveFirstConversationalTurn(needsClarificationIntent, NOW, EXPIRATIONS);

  assert.deepEqual(result, { status: 'error' });
});

await check('2. primeiro turno ready -> proposed -> proposal replace saved', async () => {
  let replaceCalls = 0;
  let capturedNext = null;
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    replaceRuntimeState: async (next) => {
      replaceCalls++;
      capturedNext = next;
      return { status: 'saved', value: { stateId: 'new-id', kind: next.kind, state: next.state } };
    },
  });

  const result = await resolveFirstConversationalTurn(readyProposableIntent, NOW, EXPIRATIONS);

  assert.equal(result.status, 'proposal_saved');
  assert.equal(replaceCalls, 1);
  assert.equal(capturedNext.kind, 'proposal');
  assert.equal(capturedNext.state.status, 'awaiting_confirmation');
  assert.equal(typeof capturedNext.state.proposalId, 'string');
  assert.ok(capturedNext.state.proposalId.length > 0);
  // `action` retornada deve ser EXATAMENTE a ação que originou a
  // ProposalState persistida — mesma referência, não uma reconstrução.
  assert.equal(result.action, capturedNext.state.action);
  assert.deepEqual(result.action, {
    actionType: 'create_local_task',
    task: { title: 'Enviar relatório', description: null, deadline: null, duration: { minutes: 30, source: 'stated' } },
  });
});

await check('2b. primeiro turno proposal: proposalId NÃO aparece no resultado', async () => {
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    replaceRuntimeState: async (next) => ({
      status: 'saved',
      value: { stateId: 'new-id', kind: next.kind, state: next.state },
    }),
  });

  const result = await resolveFirstConversationalTurn(readyProposableIntent, NOW, EXPIRATIONS);

  assert.deepEqual(Object.keys(result).sort(), ['action', 'status']);
  assert.ok(!('proposalId' in result));
});

await check('2c. primeiro turno proposal: replace falha -> error, sem action', async () => {
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    replaceRuntimeState: async () => ({ status: 'error' }),
  });

  const result = await resolveFirstConversationalTurn(readyProposableIntent, NOW, EXPIRATIONS);

  assert.deepEqual(result, { status: 'error' });
});

await check('3. primeiro turno builder unsupported -> sem escrita', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });

  const result = await resolveFirstConversationalTurn(readyUnsupportedIntent, NOW, EXPIRATIONS);

  assert.equal(result.status, 'unsupported');
});

await check('4. primeiro turno builder not_materializable -> sem escrita', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });

  const result = await resolveFirstConversationalTurn(readyNotMaterializableIntent, NOW, EXPIRATIONS);

  assert.equal(result.status, 'not_materializable');
});

await check('1b. primeiro turno com state ativo -> already_active, sem escrita', async () => {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: {
        stateId: 'existing-id',
        kind: 'clarification',
        state: fixtureConversationState({ field: 'duration', text: 'x' }),
      },
    }),
  });

  const result = await resolveFirstConversationalTurn(needsClarificationIntent, NOW, EXPIRATIONS);

  assert.equal(result.status, 'already_active');
});

await check('1c. primeiro turno com getRuntimeState error -> erro técnico propagado', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'error' }) });

  const result = await resolveFirstConversationalTurn(needsClarificationIntent, NOW, EXPIRATIONS);

  assert.equal(result.status, 'error');
});

// ============================================================================
// TURNO DE CLARIFICAÇÃO — runtime state ausente/expirado/erro
// ============================================================================

await check('14. runtime not_found -> no_active_runtime_state, sem chamar orchestration', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });

  const result = await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);

  assert.equal(result.status, 'no_active_runtime_state');
});

await check('15. runtime expired -> runtime_expired, sem chamar orchestration', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'expired' }) });

  const result = await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);

  assert.equal(result.status, 'runtime_expired');
});

await check('16. runtime error -> erro técnico, sem chamar orchestration', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'error' }) });

  const result = await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);

  assert.equal(result.status, 'error');
});

// ============================================================================
// TURNO DE CLARIFICAÇÃO — proposal pendente
// ============================================================================

await check('17. proposal found -> NÃO chama resolveClarificationTurn, sem escrita', async () => {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'proposal-id-1', kind: 'proposal', state: fixtureProposalState() },
    }),
  });

  const result = await resolveClarificationConversationalTurn('sim', NOW, EXPIRATIONS);

  assert.equal(result.status, 'proposal_pending');
});

// ============================================================================
// TURNO DE CLARIFICAÇÃO — dispatch de resolveClarificationTurn (found + clarification)
// ============================================================================

await check('9. ambiguous -> nenhuma escrita', async () => {
  foundClarification('state-A', { status: 'ambiguous', state: fixtureConversationState({ field: 'time', text: 'x' }) });

  const result = await resolveClarificationConversationalTurn('às quatro', NOW, EXPIRATIONS);

  assert.equal(result.status, 'ambiguous');
});

await check('10. unrecognized -> nenhuma escrita', async () => {
  foundClarification('state-A', {
    status: 'unrecognized',
    state: fixtureConversationState({ field: 'duration', text: 'x' }),
  });

  const result = await resolveClarificationConversationalTurn('não sei', NOW, EXPIRATIONS);

  assert.equal(result.status, 'unrecognized');
});

await check(
  '11. reference not_found (orchestration) -> reference_not_found, nunca confundido com storage not_found',
  async () => {
    foundClarification('state-A', {
      status: 'not_found',
      state: fixtureConversationState({ field: 'event_reference', text: 'x' }),
    });

    const result = await resolveClarificationConversationalTurn('a reunião de terça', NOW, EXPIRATIONS);

    assert.equal(result.status, 'reference_not_found');
    assert.notEqual(result.status, 'no_active_runtime_state');
  },
);

await check('12. orchestration unsupported -> nenhuma escrita', async () => {
  foundClarification('state-A', {
    status: 'unsupported',
    state: fixtureConversationState({ field: 'participant', text: 'x' }),
  });

  const result = await resolveClarificationConversationalTurn('João', NOW, EXPIRATIONS);

  assert.equal(result.status, 'unsupported');
});

await check('13. orchestration error -> erro técnico', async () => {
  foundClarification('state-A', { status: 'error', state: fixtureConversationState({ field: 'event_reference', text: 'x' }) });

  const result = await resolveClarificationConversationalTurn('a reunião de terça', NOW, EXPIRATIONS);

  assert.equal(result.status, 'error');
});

// ============================================================================
// TURNO DE CLARIFICAÇÃO — awaiting_clarification (advance)
// ============================================================================

await check('5 e 20. awaiting_clarification -> advance com expectedStateId exato do GET', async () => {
  const nextConversationState = fixtureConversationState({ field: 'time', text: 'y' });
  let advanceCalls = 0;
  let capturedExpectedStateId = null;
  let capturedNext = null;

  foundClarification('distinctive-state-id-123', {
    status: 'awaiting_clarification',
    state: nextConversationState,
  });
  storageHandlers.advanceRuntimeState = async (expectedStateId, next) => {
    advanceCalls++;
    capturedExpectedStateId = expectedStateId;
    capturedNext = next;
    return { status: 'advanced', value: { stateId: 'new-state-id', kind: next.kind, state: next.state } };
  };

  const result = await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);

  assert.equal(result.status, 'clarification_saved');
  assert.equal(advanceCalls, 1);
  assert.equal(capturedExpectedStateId, 'distinctive-state-id-123');
  assert.equal(capturedNext.kind, 'clarification');
  assert.equal(capturedNext.state, nextConversationState);
  // `question` deve vir do estado que ACABOU de ser avançado (o novo
  // currentQuestion, campo 'time'), nunca do estado antigo (campo
  // 'duration', usado por foundClarification/fixtureConversationState).
  assert.equal(result.question, 'y');
  assert.equal(result.question, nextConversationState.currentQuestion.text);
});

await check('5b. awaiting_clarification: nenhum campo externo vaza no resultado', async () => {
  const nextConversationState = fixtureConversationState({ field: 'time', text: 'y' });
  foundClarification('state-A', { status: 'awaiting_clarification', state: nextConversationState });
  storageHandlers.advanceRuntimeState = async (expectedStateId, next) => ({
    status: 'advanced',
    value: { stateId: 'new-state-id', kind: next.kind, state: next.state },
  });

  const result = await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);

  assert.deepEqual(Object.keys(result).sort(), ['question', 'status']);
});

// ============================================================================
// TURNO DE CLARIFICAÇÃO — ready (proposed / unsupported / not_materializable)
// ============================================================================

await check('6 e 16. ready -> proposed -> advance com troca clarification -> proposal', async () => {
  let advanceCalls = 0;
  let capturedNext = null;
  let capturedExpectedStateId = null;

  foundClarification('distinctive-state-id-456', { status: 'ready', intent: readyProposableIntent });
  storageHandlers.advanceRuntimeState = async (expectedStateId, next) => {
    advanceCalls++;
    capturedExpectedStateId = expectedStateId;
    capturedNext = next;
    return { status: 'advanced', value: { stateId: 'new-state-id-789', kind: next.kind, state: next.state } };
  };

  const result = await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);

  assert.equal(result.status, 'proposal_saved');
  assert.equal(advanceCalls, 1);
  assert.equal(capturedExpectedStateId, 'distinctive-state-id-456');
  // Troca de kind clarification -> proposal no MESMO advance:
  assert.equal(capturedNext.kind, 'proposal');
  assert.equal(capturedNext.state.status, 'awaiting_confirmation');
  // `action` retornada é EXATAMENTE a ação que originou a ProposalState
  // persistida no mesmo advance — mesma referência.
  assert.equal(result.action, capturedNext.state.action);
  assert.deepEqual(result.action, {
    actionType: 'create_local_task',
    task: { title: 'Enviar relatório', description: null, deadline: null, duration: { minutes: 30, source: 'stated' } },
  });
  assert.deepEqual(Object.keys(result).sort(), ['action', 'status']);
});

await check('21. proposalId gerado é diferente do stateId antigo e do novo', async () => {
  let capturedNext = null;
  foundClarification('old-state-id-111', { status: 'ready', intent: readyProposableIntent });
  storageHandlers.advanceRuntimeState = async (expectedStateId, next) => {
    capturedNext = next;
    return { status: 'advanced', value: { stateId: 'new-state-id-222', kind: next.kind, state: next.state } };
  };

  await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);

  const proposalId = capturedNext.state.proposalId;
  assert.equal(typeof proposalId, 'string');
  assert.ok(proposalId.length > 0);
  assert.notEqual(proposalId, 'old-state-id-111');
  assert.notEqual(proposalId, 'new-state-id-222');
});

await check('7. ready -> builder unsupported -> nenhuma escrita', async () => {
  foundClarification('state-A', { status: 'ready', intent: readyUnsupportedIntent });

  const result = await resolveClarificationConversationalTurn('qualquer coisa', NOW, EXPIRATIONS);

  assert.equal(result.status, 'unsupported');
});

await check('8. ready -> builder not_materializable -> nenhuma escrita', async () => {
  foundClarification('state-A', { status: 'ready', intent: readyNotMaterializableIntent });

  const result = await resolveClarificationConversationalTurn('1 hora', NOW, EXPIRATIONS);

  assert.equal(result.status, 'not_materializable');
});

// ============================================================================
// CONFLICT / ERROR NO ADVANCE
// ============================================================================

await check('18. advance conflict -> nenhuma segunda escrita, nenhum replace, sem question', async () => {
  let advanceCalls = 0;
  foundClarification('state-A', {
    status: 'awaiting_clarification',
    state: fixtureConversationState({ field: 'duration', text: 'x' }),
  });
  storageHandlers.advanceRuntimeState = async () => {
    advanceCalls++;
    return { status: 'conflict' };
  };
  // replaceRuntimeState permanece "unconfigured" (lança) — prova que
  // nenhum fallback para replace acontece após conflict.

  const result = await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);

  assert.deepEqual(result, { status: 'conflict' });
  assert.equal(advanceCalls, 1);
});

await check('18b. ready -> proposed -> advance conflict -> conflict, sem action', async () => {
  foundClarification('state-A', { status: 'ready', intent: readyProposableIntent });
  storageHandlers.advanceRuntimeState = async () => ({ status: 'conflict' });

  const result = await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);

  assert.deepEqual(result, { status: 'conflict' });
});

await check('19. advance error -> erro técnico', async () => {
  foundClarification('state-A', {
    status: 'awaiting_clarification',
    state: fixtureConversationState({ field: 'duration', text: 'x' }),
  });
  storageHandlers.advanceRuntimeState = async () => ({ status: 'error' });

  const result = await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);

  assert.equal(result.status, 'error');
});

await check('22. duas evoluções concorrentes simuladas: uma advanced, outra conflict', async () => {
  let callCount = 0;
  foundClarification('state-A', {
    status: 'awaiting_clarification',
    state: fixtureConversationState({ field: 'duration', text: 'x' }),
  });
  storageHandlers.advanceRuntimeState = async (expectedStateId, next) => {
    callCount++;
    if (callCount === 1) {
      return { status: 'advanced', value: { stateId: 'state-B', kind: next.kind, state: next.state } };
    }
    return { status: 'conflict' };
  };

  const first = await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);
  const second = await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);

  assert.equal(first.status, 'clarification_saved');
  assert.equal(second.status, 'conflict');
});

// ============================================================================
// 24-25. TESTES CRÍTICOS — clarificationExpiresAt (A) e proposalExpiresAt (B)
// nunca trocados entre os dois caminhos. Usam CLARIFICATION_EXPIRES_AT !==
// PROPOSAL_EXPIRES_AT deliberadamente (ver definição de EXPIRATIONS acima) —
// se alguém voltar a usar um único timestamp para os dois campos, pelo
// menos uma das asserções abaixo falha.
// ============================================================================

await check('24. first-turn: clarification usa A, proposal usa B — nunca trocados', async () => {
  // Caminho clarification
  let capturedClarification = null;
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    replaceRuntimeState: async (next) => {
      capturedClarification = next;
      return { status: 'saved', value: { stateId: 'new-id', kind: next.kind, state: next.state } };
    },
  });
  await resolveFirstConversationalTurn(needsClarificationIntent, NOW, EXPIRATIONS);
  assert.equal(capturedClarification.state.expiresAt, CLARIFICATION_EXPIRES_AT);
  assert.notEqual(capturedClarification.state.expiresAt, PROPOSAL_EXPIRES_AT);

  // Caminho proposal
  let capturedProposal = null;
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    replaceRuntimeState: async (next) => {
      capturedProposal = next;
      return { status: 'saved', value: { stateId: 'new-id', kind: next.kind, state: next.state } };
    },
  });
  await resolveFirstConversationalTurn(readyProposableIntent, NOW, EXPIRATIONS);
  assert.equal(capturedProposal.state.expiresAt, PROPOSAL_EXPIRES_AT);
  assert.notEqual(capturedProposal.state.expiresAt, CLARIFICATION_EXPIRES_AT);
});

await check(
  '25. continued turn: orchestration recebe A (clarification), ProposalState persistida usa B (proposal) — nunca trocados',
  async () => {
    // Caminho awaiting_clarification: captura o 4º argumento (nextExpiresAt)
    // realmente recebido por resolveClarificationTurn.
    let capturedOrchestrationExpiresAt = null;
    setHandlers({
      getRuntimeState: async () => ({
        status: 'found',
        value: {
          stateId: 'state-A',
          kind: 'clarification',
          state: fixtureConversationState({ field: 'duration', text: 'x' }),
        },
      }),
      resolveClarificationTurn: async (state, answer, now, nextExpiresAt) => {
        capturedOrchestrationExpiresAt = nextExpiresAt;
        return { status: 'awaiting_clarification', state: fixtureConversationState({ field: 'time', text: 'y' }) };
      },
    });
    storageHandlers.advanceRuntimeState = async (expectedStateId, next) => ({
      status: 'advanced',
      value: { stateId: 'new-id', kind: next.kind, state: next.state },
    });
    await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);
    assert.equal(capturedOrchestrationExpiresAt, CLARIFICATION_EXPIRES_AT);
    assert.notEqual(capturedOrchestrationExpiresAt, PROPOSAL_EXPIRES_AT);

    // Caminho ready -> proposal: captura o expiresAt persistido na
    // ProposalState via advanceRuntimeState.
    let capturedProposalNext = null;
    setHandlers({
      getRuntimeState: async () => ({
        status: 'found',
        value: {
          stateId: 'state-B',
          kind: 'clarification',
          state: fixtureConversationState({ field: 'duration', text: 'x' }),
        },
      }),
      resolveClarificationTurn: async () => ({ status: 'ready', intent: readyProposableIntent }),
    });
    storageHandlers.advanceRuntimeState = async (expectedStateId, next) => {
      capturedProposalNext = next;
      return { status: 'advanced', value: { stateId: 'new-id', kind: next.kind, state: next.state } };
    };
    await resolveClarificationConversationalTurn('30 minutos', NOW, EXPIRATIONS);
    assert.equal(capturedProposalNext.state.expiresAt, PROPOSAL_EXPIRES_AT);
    assert.notEqual(capturedProposalNext.state.expiresAt, CLARIFICATION_EXPIRES_AT);
  },
);

// ============================================================================
// 23. NENHUM CAMINHO EXECUTA AÇÃO REAL — verificação estática do arquivo-fonte
// ============================================================================

await check('23. arquivo-fonte não referencia nenhum código de Execution/UI/rota', () => {
  const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/conversation-turn.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  // Remove comentários de linha antes de checar — o cabeçalho do módulo
  // documenta deliberadamente essas ausências em prosa (ex.: "nenhuma
  // chamada de Calendar"), o que não deve contar como código real.
  const codeOnly = source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  const forbidden = [
    '.insert(',
    '.update(',
    '.delete(',
    'Calendar',
    'Anthropic',
    'OpenAI',
    'NextResponse',
    'createClient(',
    'service_role',
    'createAdminClient',
    'deps',
    'Deps',
    '__test',
    'mock',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado no código real do arquivo-fonte: ${token}`);
  }
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
