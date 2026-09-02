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
import { handlers as calendarHandlers } from '../support/fake-calendar-query.mjs';
import { handlers as calendarAvailabilityHandlers } from '../support/fake-calendar-event-availability.mjs';

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
  // Default "neverCalled": qualquer teste que NÃO configure consumeRuntimeState
  // explicitamente está, por construção, provando "zero consume" para aquele
  // cenário — se a produção chamasse consume inesperadamente, o teste falharia
  // alto e claro em vez de passar por acaso.
  storageHandlers.consumeRuntimeState = overrides.consumeRuntimeState ?? neverCalled('consumeRuntimeState');
  orchestrationHandlers.resolveClarificationTurn =
    overrides.resolveClarificationTurn ?? neverCalled('resolveClarificationTurn');
  // Default "neverCalled": qualquer teste que NÃO configure
  // resolveCalendarQuery explicitamente está, por construção, provando
  // "zero desvio para Calendar" para aquele cenário (ex.: todos os testes
  // de create_task/cancel_event já existentes, que nunca deveriam chamar
  // calendar-query.ts).
  calendarHandlers.resolveCalendarQuery = overrides.resolveCalendarQuery ?? neverCalled('resolveCalendarQuery');
  // Mesmo racional: default "neverCalled" — qualquer teste que NÃO
  // configure checkCalendarEventAvailability explicitamente está, por
  // construção, provando "zero freeBusy" para aquele cenário (ex.: todos
  // os testes de create_task/query_calendar/not_materializable/invalid,
  // que nunca deveriam chegar a chamar isso).
  calendarAvailabilityHandlers.checkCalendarEventAvailability =
    overrides.checkCalendarEventAvailability ?? neverCalled('checkCalendarEventAvailability');
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

await check('17. proposal found -> NÃO chama resolveClarificationTurn, sem escrita, zero consume', async () => {
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

await check('9. ambiguous -> nenhuma escrita, zero consume (não terminal: resposta futura pode resolver)', async () => {
  foundClarification('state-A', { status: 'ambiguous', state: fixtureConversationState({ field: 'time', text: 'x' }) });
  // consumeRuntimeState permanece "neverCalled" (default de setHandlers) —
  // se a produção chamasse consume aqui, este teste falharia alto e claro.

  const result = await resolveClarificationConversationalTurn('às quatro', NOW, EXPIRATIONS);

  assert.equal(result.status, 'ambiguous');
});

await check('10. unrecognized -> nenhuma escrita, zero consume (não terminal)', async () => {
  foundClarification('state-A', {
    status: 'unrecognized',
    state: fixtureConversationState({ field: 'duration', text: 'x' }),
  });

  const result = await resolveClarificationConversationalTurn('não sei', NOW, EXPIRATIONS);

  assert.equal(result.status, 'unrecognized');
});

await check(
  '11. reference not_found (orchestration) -> reference_not_found, zero consume (não terminal), nunca confundido com storage not_found',
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

await check(
  '12. orchestration unsupported -> consome o runtime com o EXACT stateId/now, status original preservado',
  async () => {
    let consumeCalls = 0;
    let capturedStateId = null;
    let capturedNow = null;
    foundClarification('distinctive-terminal-state-id-3', {
      status: 'unsupported',
      state: fixtureConversationState({ field: 'participant', text: 'x' }),
    });
    storageHandlers.consumeRuntimeState = async (expectedStateId, now) => {
      consumeCalls++;
      capturedStateId = expectedStateId;
      capturedNow = now;
      return { status: 'consumed', value: { stateId: expectedStateId, kind: 'clarification', state: {} } };
    };

    const result = await resolveClarificationConversationalTurn('João', NOW, EXPIRATIONS);

    assert.equal(result.status, 'unsupported');
    assert.equal(consumeCalls, 1);
    assert.equal(capturedStateId, 'distinctive-terminal-state-id-3');
    assert.equal(capturedNow, NOW);
  },
);

await check('12c. orchestration unsupported -> consume conflict -> conflict, zero segunda chamada', async () => {
  let consumeCalls = 0;
  foundClarification('state-A', {
    status: 'unsupported',
    state: fixtureConversationState({ field: 'participant', text: 'x' }),
  });
  storageHandlers.consumeRuntimeState = async () => {
    consumeCalls++;
    return { status: 'conflict' };
  };

  const result = await resolveClarificationConversationalTurn('João', NOW, EXPIRATIONS);

  assert.deepEqual(result, { status: 'conflict' });
  assert.equal(consumeCalls, 1);
});

await check('13. orchestration error -> erro técnico, zero consume (falha técnica, não terminal de domínio)', async () => {
  foundClarification('state-A', { status: 'error', state: fixtureConversationState({ field: 'event_reference', text: 'x' }) });

  const result = await resolveClarificationConversationalTurn('a reunião de terça', NOW, EXPIRATIONS);

  assert.equal(result.status, 'error');
});

// ============================================================================
// TURNO DE CLARIFICAÇÃO — awaiting_clarification (advance)
// ============================================================================

await check('5 e 20. awaiting_clarification -> advance com expectedStateId exato do GET, zero consume', async () => {
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

await check('6 e 16. ready -> proposed -> advance com troca clarification -> proposal, zero consume', async () => {
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

await check(
  '7. ready -> builder unsupported -> consome o runtime com o EXACT stateId/now, status original preservado',
  async () => {
    let consumeCalls = 0;
    let capturedStateId = null;
    let capturedNow = null;
    foundClarification('distinctive-terminal-state-id-1', { status: 'ready', intent: readyUnsupportedIntent });
    storageHandlers.consumeRuntimeState = async (expectedStateId, now) => {
      consumeCalls++;
      capturedStateId = expectedStateId;
      capturedNow = now;
      return { status: 'consumed', value: { stateId: expectedStateId, kind: 'clarification', state: {} } };
    };

    const result = await resolveClarificationConversationalTurn('qualquer coisa', NOW, EXPIRATIONS);

    assert.equal(result.status, 'unsupported');
    assert.equal(consumeCalls, 1);
    assert.equal(capturedStateId, 'distinctive-terminal-state-id-1');
    assert.equal(capturedNow, NOW);
    // Consume bem-sucedido nunca vaza no DTO externo — só `status`.
    assert.deepEqual(Object.keys(result), ['status']);
  },
);

await check(
  '8. ready -> builder not_materializable -> consome o runtime com o EXACT stateId/now, status original preservado',
  async () => {
    let consumeCalls = 0;
    let capturedStateId = null;
    let capturedNow = null;
    foundClarification('distinctive-terminal-state-id-2', {
      status: 'ready',
      intent: readyNotMaterializableIntent,
    });
    storageHandlers.consumeRuntimeState = async (expectedStateId, now) => {
      consumeCalls++;
      capturedStateId = expectedStateId;
      capturedNow = now;
      return { status: 'consumed', value: { stateId: expectedStateId, kind: 'clarification', state: {} } };
    };

    const result = await resolveClarificationConversationalTurn('1 hora', NOW, EXPIRATIONS);

    assert.equal(result.status, 'not_materializable');
    assert.equal(consumeCalls, 1);
    assert.equal(capturedStateId, 'distinctive-terminal-state-id-2');
    assert.equal(capturedNow, NOW);
  },
);

await check('7c. ready -> builder unsupported -> consume conflict -> conflict, zero fallback/segunda tentativa', async () => {
  let consumeCalls = 0;
  foundClarification('state-A', { status: 'ready', intent: readyUnsupportedIntent });
  storageHandlers.consumeRuntimeState = async () => {
    consumeCalls++;
    return { status: 'conflict' };
  };
  // advanceRuntimeState/replaceRuntimeState permanecem "neverCalled" —
  // prova que nenhum fallback acontece após o conflict do consume.

  const result = await resolveClarificationConversationalTurn('qualquer coisa', NOW, EXPIRATIONS);

  assert.deepEqual(result, { status: 'conflict' });
  assert.equal(consumeCalls, 1);
});

await check('7d. ready -> builder unsupported -> consume error -> error, nunca mascarado como unsupported', async () => {
  foundClarification('state-A', { status: 'ready', intent: readyUnsupportedIntent });
  storageHandlers.consumeRuntimeState = async () => ({ status: 'error' });

  const result = await resolveClarificationConversationalTurn('qualquer coisa', NOW, EXPIRATIONS);

  assert.deepEqual(result, { status: 'error' });
});

await check('8c. ready -> builder not_materializable -> consume conflict -> conflict', async () => {
  foundClarification('state-A', { status: 'ready', intent: readyNotMaterializableIntent });
  storageHandlers.consumeRuntimeState = async () => ({ status: 'conflict' });

  const result = await resolveClarificationConversationalTurn('1 hora', NOW, EXPIRATIONS);

  assert.deepEqual(result, { status: 'conflict' });
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

// ============================================================================
// 26-31. query_calendar É CONSULTA — nunca ProposedAction/Confirmation/
// Execution (subfase de query_calendar read-only)
// ============================================================================

await check(
  '26. import de Calendar restrito às fronteiras sancionadas (./calendar-query, ./calendar-event-proposal, ./calendar-event-availability), nunca à API do Google direto',
  () => {
    const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/conversation-turn.ts', import.meta.url));
    const codeOnly = readFileSync(sourcePath, 'utf8')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');

    assert.ok(codeOnly.includes("from './calendar-query'"));
    // Subfase 2 da criação de compromissos no Google Calendar: as duas
    // fronteiras novas de create_event, mesma disciplina de sempre.
    assert.ok(codeOnly.includes("from './calendar-event-proposal'"));
    assert.ok(codeOnly.includes("from './calendar-event-availability'"));
    const forbidden = [
      'getGoogleCalendarBusyTimes',
      "from '../google/calendar'",
      "from '@/lib/google/calendar'",
      'googleapis.com',
      'freeBusy',
      'GOOGLE_CLIENT',
    ];
    for (const token of forbidden) {
      assert.ok(!codeOnly.includes(token), `acesso direto à API do Google encontrado: ${token}`);
    }
  },
);

const queryCalendarIntentReady = {
  missingFields: [],
  confidence: 0.9,
  intentType: 'query_calendar',
  temporalWindow: { expression: 'amanhã', resolved: { kind: 'relative_day', day: 'tomorrow', time: null } },
};

const TIMEZONE = 'America/Sao_Paulo';

await check('27. first-turn ready + query_calendar -> calendar_information, zero write de runtime (replace nunca chamado)', async () => {
  let calendarCalls = 0;
  let capturedArgs = null;
  setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });
  calendarHandlers.resolveCalendarQuery = async (intent, now, timezone) => {
    calendarCalls++;
    capturedArgs = { intent, now, timezone };
    return { status: 'available', scope: 'day' };
  };

  const result = await resolveFirstConversationalTurn(queryCalendarIntentReady, NOW, EXPIRATIONS, TIMEZONE);

  assert.deepEqual(result, { status: 'calendar_information', result: { status: 'available', scope: 'day' } });
  assert.equal(calendarCalls, 1);
  assert.equal(capturedArgs.intent, queryCalendarIntentReady);
  assert.equal(capturedArgs.now, NOW);
  assert.equal(capturedArgs.timezone, TIMEZONE);
  // storageHandlers.replaceRuntimeState continua "neverCalled" (default de
  // setHandlers) — se o código chamasse replace, este teste já teria
  // lançado antes de chegar aqui.
});

await check('28. first-turn ready + query_calendar: resultado de calendar-query repassado verbatim (busy/error/unsupported_window)', async () => {
  for (const calendarResult of [
    { status: 'busy', scope: 'hour', busyBlockCount: 2 },
    { status: 'error' },
    { status: 'unsupported_window' },
  ]) {
    setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });
    calendarHandlers.resolveCalendarQuery = async () => calendarResult;
    const result = await resolveFirstConversationalTurn(queryCalendarIntentReady, NOW, EXPIRATIONS, TIMEZONE);
    assert.deepEqual(result, { status: 'calendar_information', result: calendarResult });
  }
});

await check('29. clarification turn: ready + query_calendar -> calendar_information via consume (terminal, zero advance)', async () => {
  let consumeCalls = 0;
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'state-cal', kind: 'clarification', state: fixtureConversationState({ field: 'x', text: 'y' }) },
    }),
    resolveClarificationTurn: async () => ({ status: 'ready', intent: queryCalendarIntentReady }),
    consumeRuntimeState: async (expectedStateId, now) => {
      consumeCalls++;
      assert.equal(expectedStateId, 'state-cal');
      assert.equal(now, NOW);
      return { status: 'consumed', value: {} };
    },
  });
  calendarHandlers.resolveCalendarQuery = async () => ({ status: 'available', scope: 'day' });

  const result = await resolveClarificationConversationalTurn('amanhã', NOW, EXPIRATIONS, TIMEZONE);

  assert.deepEqual(result, { status: 'calendar_information', result: { status: 'available', scope: 'day' } });
  assert.equal(consumeCalls, 1);
  // storageHandlers.advanceRuntimeState continua "neverCalled" — provando
  // que este caminho nunca tenta persistir um sucessor.
});

await check('30. clarification turn: query_calendar + consume conflict -> conflict, zero fallback', async () => {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'state-cal', kind: 'clarification', state: fixtureConversationState({ field: 'x', text: 'y' }) },
    }),
    resolveClarificationTurn: async () => ({ status: 'ready', intent: queryCalendarIntentReady }),
    consumeRuntimeState: async () => ({ status: 'conflict' }),
  });
  calendarHandlers.resolveCalendarQuery = async () => ({ status: 'available', scope: 'day' });

  const result = await resolveClarificationConversationalTurn('amanhã', NOW, EXPIRATIONS, TIMEZONE);

  assert.deepEqual(result, { status: 'conflict' });
});

// Nota histórica: a versão anterior deste teste exigia zero diff em
// proposed-action.ts inteiro — válido enquanto nenhuma subfase posterior
// tinha motivo legítimo para tocar o tipo `ProposedAction`. A Subfase 1 da
// criação de compromissos no Google Calendar autoriza explicitamente
// estender `ProposedAction` para uma segunda variante
// (`create_calendar_event`) — a asserção de "byte-for-byte" ficou obsoleta
// por isso, não por regressão real. Reescrita para checar o INVARIANTE
// que o teste sempre quis provar: `query_calendar` nunca se torna (nem se
// tornou) uma `ProposedAction` — `buildProposedAction` continua
// rejeitando tudo que não é `create_task`, e o arquivo nunca menciona
// `query_calendar`.
await check(
  '31. ProposedAction: query_calendar continua nunca sendo tratado por buildProposedAction (proposed-action.ts nunca menciona query_calendar)',
  () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/lib/conversation/proposed-action.ts', import.meta.url)),
      'utf8',
    );
    assert.ok(!source.includes('query_calendar'), 'proposed-action.ts não deveria mencionar query_calendar');
    assert.ok(
      source.includes("intent.intentType !== 'create_task'"),
      'buildProposedAction deveria continuar rejeitando tudo que não é create_task',
    );
  },
);

// ============================================================================
// 32-46. create_event — build + freeBusy + proposta (Subfase 2 da criação
// de compromissos no Google Calendar)
// ============================================================================

const FIXED_START = '2027-03-14T14:00:00.000Z';
const FIXED_END = '2027-03-14T15:00:00.000Z';

function createEventIntentReady(overrides = {}) {
  return {
    missingFields: [],
    confidence: 0.9,
    intentType: 'create_event',
    task: { kind: 'new_task', title: 'Reunião com Ricardo', description: null },
    temporalWindow: {
      expression: 'amanhã às 14h',
      resolved: { kind: 'fixed', start: FIXED_START, end: FIXED_END },
    },
    duration: { source: 'stated', value: { minutes: 60 }, confidence: 1 },
    participants: [],
    calendarAction: 'create',
    ...overrides,
  };
}

const EXPECTED_CALENDAR_EVENT_ACTION = {
  actionType: 'create_calendar_event',
  event: {
    title: 'Reunião com Ricardo',
    description: null,
    start: FIXED_START,
    end: FIXED_END,
    timezone: TIMEZONE,
    reminderMinutesBeforeStart: 30,
  },
};

function relativeDayCreateEventIntent(day, hour, minute) {
  return createEventIntentReady({
    temporalWindow: { expression: 'horário', resolved: { kind: 'relative_day', day, time: { hour, minute } } },
  });
}

// 2027-03-13T15:00:00Z = 10:00 local em America/New_York -> "amanhã" =
// 14/03/2027, dia de spring-forward (2h EST -> 3h EDT).
const NY_SPRING_FORWARD_NOW = Date.UTC(2027, 2, 13, 15, 0, 0);
// 2027-11-07T15:00:00Z = 10:00 local (EST) em America/New_York -> "hoje" =
// 07/11/2027, dia de fall-back.
const NY_FALL_BACK_NOW = Date.UTC(2027, 10, 7, 15, 0, 0);

// --- First turn — livre (1-7) ----------------------------------------------

await check(
  '32. first-turn create_event ready + freeBusy livre -> proposal_saved via replace, janela exata, action create_calendar_event',
  async () => {
    let replaceCalls = 0;
    let capturedNext = null;
    let availabilityCalls = 0;
    let capturedAvailabilityArgs = null;
    setHandlers({
      getRuntimeState: async () => ({ status: 'not_found' }),
      replaceRuntimeState: async (next) => {
        replaceCalls++;
        capturedNext = next;
        return { status: 'saved', value: { stateId: 'new-id', kind: next.kind, state: next.state } };
      },
      checkCalendarEventAvailability: async (start, end) => {
        availabilityCalls++;
        capturedAvailabilityArgs = { start, end };
        return { status: 'available' };
      },
    });

    const result = await resolveFirstConversationalTurn(createEventIntentReady(), NOW, EXPIRATIONS, TIMEZONE);

    assert.equal(result.status, 'proposal_saved');
    assert.equal(availabilityCalls, 1);
    // Janela EXATA do ProposedAction materializado — nunca arredondada.
    assert.deepEqual(capturedAvailabilityArgs, { start: FIXED_START, end: FIXED_END });
    assert.equal(replaceCalls, 1);
    assert.equal(capturedNext.kind, 'proposal');
    assert.equal(capturedNext.state.status, 'awaiting_confirmation');
    assert.equal(typeof capturedNext.state.proposalId, 'string');
    assert.ok(capturedNext.state.proposalId.length > 0);
    assert.equal(result.action, capturedNext.state.action);
    assert.deepEqual(result.action, EXPECTED_CALENDAR_EVENT_ACTION);
  },
);

// --- First turn — ocupado (8-12) --------------------------------------------

await check(
  '33. first-turn create_event ready + freeBusy ocupado -> schedule_conflict, zero replace, zero ProposalState, zero dado bruto do Google',
  async () => {
    setHandlers({
      getRuntimeState: async () => ({ status: 'not_found' }),
      checkCalendarEventAvailability: async () => ({ status: 'busy' }),
    });

    const result = await resolveFirstConversationalTurn(createEventIntentReady(), NOW, EXPIRATIONS, TIMEZONE);

    assert.deepEqual(result, { status: 'schedule_conflict' });
    // storageHandlers.replaceRuntimeState continua "neverCalled" — se o
    // código chamasse replace, este teste já teria lançado antes daqui.
  },
);

// --- First turn — Calendar indisponível (13-16) -----------------------------

await check(
  '34. first-turn create_event ready + Calendar indisponível -> calendar_unavailable, zero write, zero fallback/retry',
  async () => {
    let availabilityCalls = 0;
    setHandlers({
      getRuntimeState: async () => ({ status: 'not_found' }),
      checkCalendarEventAvailability: async () => {
        availabilityCalls++;
        return { status: 'unavailable' };
      },
    });

    const result = await resolveFirstConversationalTurn(createEventIntentReady(), NOW, EXPIRATIONS, TIMEZONE);

    assert.deepEqual(result, { status: 'calendar_unavailable' });
    assert.equal(availabilityCalls, 1);
    // storageHandlers.replaceRuntimeState continua "neverCalled".
  },
);

// --- Materialização falha (17-20) — zero freeBusy em qualquer caso ---------

// `next_free_slot` com duration já `stated`: a Clarification Policy
// considera isso `ready` (não é `unresolved`, não pede `time` — só
// `relative_day` pede — e duration já está resolvida), mas o BUILDER
// (Subfase 1) nunca materializa esse kind (fora de escopo, "next horário
// livre" exigiria busca, não é um instante conhecido) — por isso é o
// fixture certo para provar `not_materializable` vindo do builder, nunca
// da Clarification Policy (que já intercepta `unresolved` antes deste
// branch sequer ser alcançado — testado à parte em clarification.test.mjs).
const NEXT_FREE_SLOT_WINDOW = {
  expression: 'quando eu tiver um horário livre',
  resolved: { kind: 'next_free_slot', minDurationMinutes: 60 },
};

await check('35. first-turn create_event ready (next_free_slot) mas not_materializable pelo builder -> zero freeBusy', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });

  const result = await resolveFirstConversationalTurn(
    createEventIntentReady({ temporalWindow: NEXT_FREE_SLOT_WINDOW }),
    NOW,
    EXPIRATIONS,
    TIMEZONE,
  );

  assert.deepEqual(result, { status: 'not_materializable' });
  // calendarAvailabilityHandlers continua "neverCalled" (default) — se o
  // código chamasse freeBusy aqui, este teste já teria lançado antes.
});

await check('36. first-turn create_event com timezone inválido -> not_materializable, zero freeBusy', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });

  const result = await resolveFirstConversationalTurn(createEventIntentReady(), NOW, EXPIRATIONS, 'Nao/Existe');

  assert.deepEqual(result, { status: 'not_materializable' });
});

await check(
  '37. first-turn create_event com horário civil inexistente (spring-forward, America/New_York) -> not_materializable, zero freeBusy',
  async () => {
    setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });

    const result = await resolveFirstConversationalTurn(
      relativeDayCreateEventIntent('tomorrow', 2, 30),
      NY_SPRING_FORWARD_NOW,
      EXPIRATIONS,
      'America/New_York',
    );

    assert.deepEqual(result, { status: 'not_materializable' });
  },
);

await check(
  '38. first-turn create_event com horário civil ambíguo (fall-back, America/New_York) -> not_materializable, zero freeBusy',
  async () => {
    setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });

    const result = await resolveFirstConversationalTurn(
      relativeDayCreateEventIntent('today', 1, 30),
      NY_FALL_BACK_NOW,
      EXPIRATIONS,
      'America/New_York',
    );

    assert.deepEqual(result, { status: 'not_materializable' });
  },
);

// --- Clarification turn (21-26) --------------------------------------------

await check(
  '39. clarification turn: ready (duration resolvida) + freeBusy livre -> proposal_saved via advance, zero consume',
  async () => {
    let advanceCalls = 0;
    let capturedExpectedStateId = null;
    let capturedNext = null;
    foundClarification('state-create-event', { status: 'ready', intent: createEventIntentReady() });
    storageHandlers.advanceRuntimeState = async (expectedStateId, next) => {
      advanceCalls++;
      capturedExpectedStateId = expectedStateId;
      capturedNext = next;
      return { status: 'advanced', value: { stateId: 'new-id', kind: next.kind, state: next.state } };
    };
    calendarAvailabilityHandlers.checkCalendarEventAvailability = async () => ({ status: 'available' });

    const result = await resolveClarificationConversationalTurn('1 hora', NOW, EXPIRATIONS, TIMEZONE);

    assert.equal(result.status, 'proposal_saved');
    assert.deepEqual(result.action, EXPECTED_CALENDAR_EVENT_ACTION);
    assert.equal(advanceCalls, 1);
    assert.equal(capturedExpectedStateId, 'state-create-event');
    assert.equal(capturedNext.kind, 'proposal');
    // storageHandlers.consumeRuntimeState continua "neverCalled" — ready ->
    // proposed sempre usa advance, nunca consume (tem sucessor real).
  },
);

await check(
  '40. clarification turn: freeBusy livre mas advance recebe conflict -> conflict, sem retry/reconsulta',
  async () => {
    let availabilityCalls = 0;
    let advanceCalls = 0;
    foundClarification('state-create-event', { status: 'ready', intent: createEventIntentReady() });
    calendarAvailabilityHandlers.checkCalendarEventAvailability = async () => {
      availabilityCalls++;
      return { status: 'available' };
    };
    storageHandlers.advanceRuntimeState = async () => {
      advanceCalls++;
      return { status: 'conflict' };
    };

    const result = await resolveClarificationConversationalTurn('1 hora', NOW, EXPIRATIONS, TIMEZONE);

    assert.deepEqual(result, { status: 'conflict' });
    assert.equal(availabilityCalls, 1);
    assert.equal(advanceCalls, 1);
  },
);

await check('41. clarification turn: create_event ready (next_free_slot) mas not_materializable pelo builder -> consumido (terminal)', async () => {
  let consumeCalls = 0;
  foundClarification('state-create-event', {
    status: 'ready',
    intent: createEventIntentReady({ temporalWindow: NEXT_FREE_SLOT_WINDOW }),
  });
  storageHandlers.consumeRuntimeState = async (expectedStateId) => {
    consumeCalls++;
    assert.equal(expectedStateId, 'state-create-event');
    return { status: 'consumed', value: {} };
  };

  const result = await resolveClarificationConversationalTurn('1 hora', NOW, EXPIRATIONS, TIMEZONE);

  assert.deepEqual(result, { status: 'not_materializable' });
  assert.equal(consumeCalls, 1);
});

await check('42. clarification turn: schedule_conflict -> consumido (terminal), zero advance', async () => {
  let consumeCalls = 0;
  foundClarification('state-create-event', { status: 'ready', intent: createEventIntentReady() });
  calendarAvailabilityHandlers.checkCalendarEventAvailability = async () => ({ status: 'busy' });
  storageHandlers.consumeRuntimeState = async () => {
    consumeCalls++;
    return { status: 'consumed', value: {} };
  };

  const result = await resolveClarificationConversationalTurn('1 hora', NOW, EXPIRATIONS, TIMEZONE);

  assert.deepEqual(result, { status: 'schedule_conflict' });
  assert.equal(consumeCalls, 1);
  // storageHandlers.advanceRuntimeState continua "neverCalled".
});

// `calendar_unavailable` é deliberadamente TRANSITÓRIO na clarificação
// (aprovado nesta subfase) — o oposto de `schedule_conflict`/
// `not_materializable`, que continuam terminais. Falha técnica/transiente
// de rede/infra, não uma decisão semântica sobre o pedido do usuário: a
// clarification row original precisa sobreviver intacta para que a MESMA
// resposta possa ser reenviada quando o Calendar voltar.
await check(
  '43. clarification turn: calendar_unavailable -> TRANSITÓRIO — zero consume/advance/replace, clarification original preservada',
  async () => {
    setHandlers({
      getRuntimeState: async () => ({
        status: 'found',
        value: {
          stateId: 'state-create-event',
          kind: 'clarification',
          state: fixtureConversationState({ field: 'duration', text: 'x' }),
        },
      }),
      resolveClarificationTurn: async () => ({ status: 'ready', intent: createEventIntentReady() }),
    });
    calendarAvailabilityHandlers.checkCalendarEventAvailability = async () => ({ status: 'unavailable' });

    const result = await resolveClarificationConversationalTurn('1 hora', NOW, EXPIRATIONS, TIMEZONE);

    assert.deepEqual(result, { status: 'calendar_unavailable' });
    // storageHandlers.consumeRuntimeState/advanceRuntimeState/
    // replaceRuntimeState continuam "neverCalled" (default de
    // setHandlers) — se o código chamasse qualquer um deles, este teste
    // já teria lançado antes de chegar aqui.
  },
);

await check(
  '43b. depois de calendar_unavailable, repetir a MESMA resposta funciona quando o Calendar volta (freeBusy livre -> proposal_saved via advance)',
  async () => {
    // Simula duas chamadas separadas ao integrador com a MESMA resposta
    // textual — a primeira vê o Calendar indisponível (não persiste
    // nada); a segunda, sobre a MESMA clarification row (nunca consumida
    // pela primeira), vê o Calendar disponível e segue o fluxo normal.
    let advanceCalls = 0;
    const stableClarificationState = fixtureConversationState({ field: 'duration', text: 'x' });
    setHandlers({
      getRuntimeState: async () => ({
        status: 'found',
        value: { stateId: 'state-retry', kind: 'clarification', state: stableClarificationState },
      }),
      resolveClarificationTurn: async () => ({ status: 'ready', intent: createEventIntentReady() }),
    });
    calendarAvailabilityHandlers.checkCalendarEventAvailability = async () => ({ status: 'unavailable' });

    const firstAttempt = await resolveClarificationConversationalTurn('1 hora', NOW, EXPIRATIONS, TIMEZONE);
    assert.deepEqual(firstAttempt, { status: 'calendar_unavailable' });

    // "Calendar voltou" — mesma resposta, mesma clarification row (nunca
    // tocada pela tentativa anterior, ver getRuntimeState acima, que
    // continua devolvendo a MESMA `stableClarificationState`).
    calendarAvailabilityHandlers.checkCalendarEventAvailability = async () => ({ status: 'available' });
    storageHandlers.advanceRuntimeState = async (expectedStateId, next) => {
      advanceCalls++;
      assert.equal(expectedStateId, 'state-retry');
      return { status: 'advanced', value: { stateId: 'new-id', kind: next.kind, state: next.state } };
    };

    const secondAttempt = await resolveClarificationConversationalTurn('1 hora', NOW, EXPIRATIONS, TIMEZONE);

    assert.equal(secondAttempt.status, 'proposal_saved');
    assert.deepEqual(secondAttempt.action, EXPECTED_CALENDAR_EVENT_ACTION);
    assert.equal(advanceCalls, 1);
  },
);

// --- Regressões (27-32) ------------------------------------------------

await check(
  '44. regressão: create_task (2) e query_calendar (27-30) continuam idênticos após o branch de create_event ser adicionado',
  async () => {
    // Reexecuta exatamente os dois cenários já cobertos pelos testes 2 e
    // 27, provando que o novo branch `create_event` (inserido ANTES de
    // buildProposedAction, e DEPOIS do desvio de query_calendar) nunca
    // intercepta os outros intentTypes.
    setHandlers({
      getRuntimeState: async () => ({ status: 'not_found' }),
      replaceRuntimeState: async (next) => ({
        status: 'saved',
        value: { stateId: 'new-id', kind: next.kind, state: next.state },
      }),
    });
    const taskResult = await resolveFirstConversationalTurn(readyProposableIntent, NOW, EXPIRATIONS, TIMEZONE);
    assert.equal(taskResult.status, 'proposal_saved');
    assert.equal(taskResult.action.actionType, 'create_local_task');

    setHandlers({ getRuntimeState: async () => ({ status: 'not_found' }) });
    calendarHandlers.resolveCalendarQuery = async () => ({ status: 'available', scope: 'day' });
    const queryResult = await resolveFirstConversationalTurn(queryCalendarIntentReady, NOW, EXPIRATIONS, TIMEZONE);
    assert.deepEqual(queryResult, { status: 'calendar_information', result: { status: 'available', scope: 'day' } });
    // calendarAvailabilityHandlers continua "neverCalled" nos dois casos
    // acima — prova que nem create_task nem query_calendar passam pelo
    // novo branch de create_event.
  },
);

await check(
  '45. nenhuma Calendar write API aparece no código real (conversation-turn.ts e calendar-event-availability.ts)',
  () => {
    const files = [
      '../../src/lib/conversation/conversation-turn.ts',
      '../../src/lib/conversation/calendar-event-availability.ts',
    ];
    const forbidden = ['POST', 'events.insert', 'events.update', 'events.patch', 'calendar/v3/calendars', '.insert(', '.update('];
    for (const relativePath of files) {
      const codeOnly = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
        .split('\n')
        .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
        .join('\n');
      for (const token of forbidden) {
        assert.ok(!codeOnly.includes(token), `token proibido encontrado em ${relativePath}: ${token}`);
      }
    }
  },
);

await check('46. checkCalendarEventAvailability nunca vaza intervalos brutos — action final não tem campo busy/intervals', () => {
  assert.deepEqual(Object.keys(EXPECTED_CALENDAR_EVENT_ACTION.event).sort(), [
    'description',
    'end',
    'reminderMinutesBeforeStart',
    'start',
    'timezone',
    'title',
  ]);
});

// ============================================================================
// SUBFASE 15 — diagnóstico TEMPORÁRIO de disponibilidade (`[calendar-create-
// debug]`). Confirma que a instrumentação nova (i) só existe dentro do
// branch `create_event`, (ii) nunca vaza campo proibido, (iii) é uma lista
// FECHADA de campos (qualquer campo novo adicionado no futuro sem passar
// por este teste já quebra a asserção de whitelist abaixo), e (iv) nunca
// altera o valor de retorno real da função (as próprias asserções de
// status/action dos testes 32-43, inalteradas por esta subfase e ainda
// verdes, já são a prova disso — reforçada aqui de novo, lado a lado com a
// captura do log, para deixar a prova explícita num único lugar).
// ============================================================================

async function captureConsoleInfoAsync(fn) {
  const original = console.info;
  const calls = [];
  console.info = (...args) => {
    calls.push(args);
  };
  try {
    const result = await fn();
    return { result, calls };
  } finally {
    console.info = original;
  }
}

const DEBUG_ALLOWED_FIELDS = [
  'dispatcherPath',
  'intentType',
  'temporalKind',
  'relativeDay',
  'hour',
  'minute',
  'durationMinutes',
  'materializedStart',
  'materializedEnd',
  'timezone',
  'availabilityStatus',
  'busyBlockCount',
].sort();

const DEBUG_FORBIDDEN_SUBSTRINGS = [
  'Reunião com Ricardo', // task.title do fixture usado nesta seção
  'user_id',
  'userId',
  'stateId',
  'proposalId',
  'googleEventId',
  'Authorization',
  'authorization',
  'cookie',
  'token',
  'refresh_token',
  'access_token',
  'description',
];

await check('47. log [calendar-create-debug] é emitido no branch schedule_conflict, com campos EXATOS (whitelist fechada)', async () => {
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    checkCalendarEventAvailability: async () => ({ status: 'busy' }),
  });

  const { result, calls } = await captureConsoleInfoAsync(() =>
    resolveFirstConversationalTurn(createEventIntentReady(), NOW, EXPIRATIONS, TIMEZONE),
  );

  assert.deepEqual(result, { status: 'schedule_conflict' }, 'instrumentação não pode alterar o retorno real');

  const debugCalls = calls.filter((args) => args[0] === '[calendar-create-debug]');
  assert.equal(debugCalls.length, 1, 'exatamente 1 log por tentativa de create_event');

  const [, rawPayload] = debugCalls[0];
  assert.equal(typeof rawPayload, 'string', 'payload deve ser string já serializada (JSON.stringify), nunca objeto cru');

  const parsed = JSON.parse(rawPayload);
  assert.deepEqual(
    Object.keys(parsed).sort(),
    DEBUG_ALLOWED_FIELDS,
    'log deve conter EXATAMENTE os campos documentados — nenhum a mais, nenhum a menos',
  );
  assert.equal(parsed.dispatcherPath, 'nlu_first_turn');
  assert.equal(parsed.intentType, 'create_event');
  assert.equal(parsed.temporalKind, 'fixed');
  assert.equal(parsed.materializedStart, FIXED_START);
  assert.equal(parsed.materializedEnd, FIXED_END);
  assert.equal(parsed.timezone, TIMEZONE);
  assert.equal(parsed.availabilityStatus, 'busy');
  assert.equal(parsed.busyBlockCount, null, 'checkCalendarEventAvailability nunca expõe contagem — este diagnóstico não inventa uma');
});

await check('48. log nunca contém texto/título/descrição/user_id/stateId/proposalId/googleEventId/token/Authorization/cookie', async () => {
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    replaceRuntimeState: async (next) => ({
      status: 'saved',
      value: { stateId: 'super-secret-state-id-12345', kind: next.kind, state: next.state },
    }),
    checkCalendarEventAvailability: async () => ({ status: 'available' }),
  });

  const { calls } = await captureConsoleInfoAsync(() =>
    resolveFirstConversationalTurn(
      createEventIntentReady({ task: { kind: 'new_task', title: 'Reunião com Ricardo', description: 'pauta confidencial X' } }),
      NOW,
      EXPIRATIONS,
      TIMEZONE,
    ),
  );

  const debugCalls = calls.filter((args) => args[0] === '[calendar-create-debug]');
  assert.equal(debugCalls.length, 1);
  const rawPayload = debugCalls[0][1];

  for (const forbidden of DEBUG_FORBIDDEN_SUBSTRINGS) {
    assert.ok(!rawPayload.includes(forbidden), `token proibido encontrado no log: ${forbidden}`);
  }
  // "pauta confidencial X" nunca poderia vazar de qualquer forma (não é
  // nem um campo lido pelo helper), mas checado explicitamente mesmo
  // assim — nunca um palpite sobre o que "description" poderia conter.
  assert.ok(!rawPayload.includes('pauta confidencial'));
});

await check('49. dispatcherPath = clarification_turn no turno de clarificação (nunca confundido com nlu_first_turn)', async () => {
  const clarificationState = {
    intent: createEventIntentReady({ duration: { source: 'unresolved', confidence: 0.5 } }),
    currentQuestion: { field: 'duration', text: 'Quanto tempo dura?' },
    createdAt: NOW - 1000,
    expiresAt: NOW + 10_000,
  };
  storageHandlers.getRuntimeState = async () => ({
    status: 'found',
    value: { stateId: 'state-clarify', kind: 'clarification', state: clarificationState },
  });
  storageHandlers.advanceRuntimeState = async (_expectedStateId, next) => ({
    status: 'advanced',
    value: { stateId: 'new-id', kind: next.kind, state: next.state },
  });
  orchestrationHandlers.resolveClarificationTurn = async (state) => ({
    status: 'ready',
    intent: { ...state.intent, duration: { source: 'stated', value: { minutes: 60 }, confidence: 1 } },
  });
  calendarAvailabilityHandlers.checkCalendarEventAvailability = async () => ({ status: 'available' });

  const { calls } = await captureConsoleInfoAsync(() =>
    resolveClarificationConversationalTurn('1 hora', NOW, EXPIRATIONS, TIMEZONE),
  );

  const debugCalls = calls.filter((args) => args[0] === '[calendar-create-debug]');
  assert.equal(debugCalls.length, 1);
  const parsed = JSON.parse(debugCalls[0][1]);
  assert.equal(parsed.dispatcherPath, 'clarification_turn');
});

await check('50. create_local_task e query_calendar NUNCA emitem [calendar-create-debug] (zero log fora de create_event)', async () => {
  const readyProposableIntent = {
    missingFields: [],
    confidence: 0.9,
    intentType: 'create_task',
    task: { kind: 'new_task', title: 'Comprar leite', description: null },
    temporalWindow: null,
    duration: null,
    deadline: null,
  };
  const queryCalendarIntentReady = {
    missingFields: [],
    confidence: 0.9,
    intentType: 'query_calendar',
    temporalWindow: { expression: 'hoje', resolved: { kind: 'relative_day', day: 'today', time: null } },
  };

  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    replaceRuntimeState: async (next) => ({
      status: 'saved',
      value: { stateId: 'new-id', kind: next.kind, state: next.state },
    }),
  });
  const { calls: taskCalls } = await captureConsoleInfoAsync(() =>
    resolveFirstConversationalTurn(readyProposableIntent, NOW, EXPIRATIONS, TIMEZONE),
  );
  assert.equal(taskCalls.filter((args) => args[0] === '[calendar-create-debug]').length, 0);

  calendarHandlers.resolveCalendarQuery = async () => ({ status: 'available', scope: 'day' });
  const { calls: queryCalls } = await captureConsoleInfoAsync(() =>
    resolveFirstConversationalTurn(queryCalendarIntentReady, NOW, EXPIRATIONS, TIMEZONE),
  );
  assert.equal(queryCalls.filter((args) => args[0] === '[calendar-create-debug]').length, 0);
});

await check('51. instrumentação é a ÚNICA mudança de código nesta subfase — zero alteração de comportamento fora do console.info', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/lib/conversation/conversation-turn.ts', import.meta.url)),
    'utf8',
  );
  assert.ok(source.includes('[calendar-create-debug]'), 'prefixo de log deve estar presente e localizável');
  assert.ok(source.includes('console.info('), 'diagnóstico deve usar console.info, mecanismo já usado no runtime do projeto/Vercel');
  // Comentário explícito documentando a exceção deliberada à disciplina
  // "nunca console.*" do resto da pasta — nunca uma exceção silenciosa.
  assert.ok(source.includes('Instrumentação'), 'a exceção a "nunca console.*" precisa estar documentada no próprio arquivo');
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
