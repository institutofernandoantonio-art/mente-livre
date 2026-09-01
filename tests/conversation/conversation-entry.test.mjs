// Testes unitários de src/lib/conversation/conversation-entry.ts.
//
// Execução: npm run test:conversation-entry
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão de
// tests/conversation/proposal-turn.test.mjs. Importa o MÓDULO REAL
// (`handleConversationMessage`), com quatro dependências substituídas por
// dublês via o hook de resolução em tests/support/ (runtime-state-storage,
// conversation-turn, proposal-turn, intent-extraction) — cada uma já tem
// sua própria suíte de testes real; aqui testamos SÓ o roteamento e a
// tradução de contratos deste dispatcher, nunca a lógica interna delas
// (CAS, Confirmation Policy, Execution, Anthropic — ver seção 20 da
// instrução desta subfase). `conversation-ttl.ts` é puro e usado REAL
// (nenhum dublê necessário).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleConversationMessage } from '../../src/lib/conversation/conversation-entry.ts';
import { CLARIFICATION_TTL_MS, PROPOSAL_TTL_MS } from '../../src/lib/conversation/conversation-ttl.ts';
import { handlers as storageHandlers } from '../support/fake-runtime-state-storage.mjs';
import { handlers as conversationTurnHandlers } from '../support/fake-conversation-turn.mjs';
import { handlers as proposalTurnHandlers } from '../support/fake-proposal-turn.mjs';
import { handlers as intentExtractionHandlers } from '../support/fake-intent-extraction.mjs';

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

// Reconfigura os quatro dublês antes de cada teste — nunca deixa handler
// de um teste anterior vazar para o próximo. Handlers não fornecidos em
// `overrides` permanecem "neverCalled": se o dispatcher chamar qualquer
// dependência além da esperada, o teste falha com exceção clara em vez de
// silenciosamente "passar por acaso".
function setHandlers(overrides = {}) {
  storageHandlers.getRuntimeState = overrides.getRuntimeState ?? neverCalled('getRuntimeState');
  conversationTurnHandlers.resolveFirstConversationalTurn =
    overrides.resolveFirstConversationalTurn ?? neverCalled('resolveFirstConversationalTurn');
  conversationTurnHandlers.resolveClarificationConversationalTurn =
    overrides.resolveClarificationConversationalTurn ?? neverCalled('resolveClarificationConversationalTurn');
  proposalTurnHandlers.resolveProposalConversationalTurn =
    overrides.resolveProposalConversationalTurn ?? neverCalled('resolveProposalConversationalTurn');
  intentExtractionHandlers.extractStructuredIntent =
    overrides.extractStructuredIntent ?? neverCalled('extractStructuredIntent');
}

function foundClarification(overrides = {}) {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'clarif-state-1', kind: 'clarification', state: {} },
    }),
    ...overrides,
  });
}

function foundProposal(overrides = {}) {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: { stateId: 'proposal-state-1', kind: 'proposal', state: {} },
    }),
    ...overrides,
  });
}

// --- Fixtures reais (nenhum dado pessoal) -----------------------------

const NOW = 1_700_000_000_000;
const EXPECTED_CLARIFICATION_EXPIRES_AT = NOW + CLARIFICATION_TTL_MS;
const EXPECTED_PROPOSAL_EXPIRES_AT = NOW + PROPOSAL_TTL_MS;

const VALID_INTENT = {
  missingFields: [],
  confidence: 0.9,
  intentType: 'create_task',
  task: { kind: 'new_task', title: 'Revisar orçamento', description: null },
  temporalWindow: null,
  duration: null,
  deadline: null,
};

const VALID_ACTION = {
  actionType: 'create_local_task',
  task: { title: 'Revisar orçamento', description: null, deadline: null, duration: null },
};

// ============================================================================
// 1-3. VALIDAÇÃO DE INPUT / GET COM ERRO
// ============================================================================

await check('1. texto vazio -> needs_input, zero runtime GET', async () => {
  setHandlers();
  const result = await handleConversationMessage('', NOW);
  assert.deepEqual(result, { status: 'needs_input' });
});

await check('1b. texto só espaço -> needs_input, zero runtime GET', async () => {
  setHandlers();
  const result = await handleConversationMessage('   ', NOW);
  assert.deepEqual(result, { status: 'needs_input' });
});

await check('2. now inválido (NaN) -> needs_input, zero I/O', async () => {
  setHandlers();
  const result = await handleConversationMessage('comprar leite amanhã', NaN);
  assert.deepEqual(result, { status: 'needs_input' });
});

await check('2b. now inválido (fracionário) -> needs_input, zero I/O', async () => {
  setHandlers();
  const result = await handleConversationMessage('comprar leite amanhã', NOW + 0.5);
  assert.deepEqual(result, { status: 'needs_input' });
});

await check('3. runtime GET error -> error, zero NLU/handlers', async () => {
  let getCalls = 0;
  setHandlers({
    getRuntimeState: async () => {
      getCalls++;
      return { status: 'error' };
    },
  });
  const result = await handleConversationMessage('comprar leite amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
  assert.equal(getCalls, 1);
});

// ============================================================================
// 4-5. UMA FAMÍLIA SÓ — found clarification / found proposal
// ============================================================================

await check('4. found clarification -> chama SOMENTE clarification handler', async () => {
  let getCalls = 0;
  let clarificationCalls = 0;
  foundClarification({
    getRuntimeState: async () => {
      getCalls++;
      return { status: 'found', value: { stateId: 'clarif-1', kind: 'clarification', state: {} } };
    },
    resolveClarificationConversationalTurn: async () => {
      clarificationCalls++;
      return { status: 'ambiguous' };
    },
  });

  const result = await handleConversationMessage('30 minutos', NOW);

  assert.equal(result.status, 'needs_input');
  assert.equal(getCalls, 1);
  assert.equal(clarificationCalls, 1);
  // resolveProposalConversationalTurn/extractStructuredIntent/
  // resolveFirstConversationalTurn permanecem "neverCalled" — já
  // comprovado pelo simples fato de o teste não ter lançado.
});

await check('5. found proposal -> chama SOMENTE proposal handler', async () => {
  let getCalls = 0;
  let proposalCalls = 0;
  foundProposal({
    getRuntimeState: async () => {
      getCalls++;
      return { status: 'found', value: { stateId: 'proposal-1', kind: 'proposal', state: {} } };
    },
    resolveProposalConversationalTurn: async () => {
      proposalCalls++;
      return { status: 'confirmation_ambiguous' };
    },
  });

  const result = await handleConversationMessage('talvez', NOW);

  assert.equal(result.status, 'needs_input');
  assert.equal(getCalls, 1);
  assert.equal(proposalCalls, 1);
});

// ============================================================================
// 6-7. not_found / expired -> NLU
// ============================================================================

await check('6. not_found -> chama NLU', async () => {
  let nluCalls = 0;
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    extractStructuredIntent: async () => {
      nluCalls++;
      return { status: 'invalid' };
    },
  });
  const result = await handleConversationMessage('comprar leite amanhã', NOW);
  assert.equal(result.status, 'needs_input');
  assert.equal(nluCalls, 1);
});

await check('7. expired -> chama NLU', async () => {
  let nluCalls = 0;
  setHandlers({
    getRuntimeState: async () => ({ status: 'expired' }),
    extractStructuredIntent: async () => {
      nluCalls++;
      return { status: 'invalid' };
    },
  });
  const result = await handleConversationMessage('comprar leite amanhã', NOW);
  assert.equal(result.status, 'needs_input');
  assert.equal(nluCalls, 1);
});

// ============================================================================
// 8-10. TRADUÇÃO DE SUCESSO
// ============================================================================

await check('8. clarification_saved -> clarification_required', async () => {
  foundClarification({
    resolveClarificationConversationalTurn: async () => ({
      status: 'clarification_saved',
      question: 'Quanto tempo você quer reservar?',
    }),
  });
  const result = await handleConversationMessage('30 minutos', NOW);
  assert.deepEqual(result, { status: 'clarification_required', question: 'Quanto tempo você quer reservar?' });
});

await check('9. proposal_saved (via clarification) -> proposal_ready', async () => {
  foundClarification({
    resolveClarificationConversationalTurn: async () => ({ status: 'proposal_saved', action: VALID_ACTION }),
  });
  const result = await handleConversationMessage('30 minutos', NOW);
  assert.deepEqual(result, { status: 'proposal_ready', action: VALID_ACTION });
});

await check('10. proposal_saved (via first-turn) -> proposal_ready', async () => {
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    extractStructuredIntent: async () => ({ status: 'extracted', intent: VALID_INTENT }),
    resolveFirstConversationalTurn: async () => ({ status: 'proposal_saved', action: VALID_ACTION }),
  });
  const result = await handleConversationMessage('comprar leite amanhã', NOW);
  assert.deepEqual(result, { status: 'proposal_ready', action: VALID_ACTION });
});

await check('11. confirmed -> confirmed', async () => {
  foundProposal({
    resolveProposalConversationalTurn: async () => ({ status: 'confirmed', itemId: 'item-uuid-123' }),
  });
  const result = await handleConversationMessage('sim', NOW);
  assert.deepEqual(result, { status: 'confirmed', itemId: 'item-uuid-123' });
});

await check('12. cancelled -> cancelled', async () => {
  foundProposal({
    resolveProposalConversationalTurn: async () => ({ status: 'cancelled' }),
  });
  const result = await handleConversationMessage('não', NOW);
  assert.deepEqual(result, { status: 'cancelled' });
});

// ============================================================================
// 13-17. needs_input
// ============================================================================

await check('13. clarification ambiguous -> needs_input', async () => {
  foundClarification({ resolveClarificationConversationalTurn: async () => ({ status: 'ambiguous' }) });
  const result = await handleConversationMessage('às quatro', NOW);
  assert.deepEqual(result, { status: 'needs_input' });
});

await check('14. confirmation ambiguous -> needs_input', async () => {
  foundProposal({ resolveProposalConversationalTurn: async () => ({ status: 'confirmation_ambiguous' }) });
  const result = await handleConversationMessage('talvez', NOW);
  assert.deepEqual(result, { status: 'needs_input' });
});

await check('15. clarification unrecognized -> needs_input', async () => {
  foundClarification({ resolveClarificationConversationalTurn: async () => ({ status: 'unrecognized' }) });
  const result = await handleConversationMessage('não sei', NOW);
  assert.deepEqual(result, { status: 'needs_input' });
});

await check('16. confirmation unrecognized -> needs_input', async () => {
  foundProposal({ resolveProposalConversationalTurn: async () => ({ status: 'confirmation_unrecognized' }) });
  const result = await handleConversationMessage('me explica', NOW);
  assert.deepEqual(result, { status: 'needs_input' });
});

await check('17. reference_not_found -> needs_input', async () => {
  foundClarification({ resolveClarificationConversationalTurn: async () => ({ status: 'reference_not_found' }) });
  const result = await handleConversationMessage('a reunião de terça', NOW);
  assert.deepEqual(result, { status: 'needs_input' });
});

// ============================================================================
// 18-19. unsupported
// ============================================================================

await check('18. unsupported (clarification-turn) -> unsupported', async () => {
  foundClarification({ resolveClarificationConversationalTurn: async () => ({ status: 'unsupported' }) });
  const result = await handleConversationMessage('João', NOW);
  assert.deepEqual(result, { status: 'unsupported' });
});

await check('18b. unsupported (first-turn) -> unsupported', async () => {
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    extractStructuredIntent: async () => ({ status: 'extracted', intent: VALID_INTENT }),
    resolveFirstConversationalTurn: async () => ({ status: 'unsupported' }),
  });
  const result = await handleConversationMessage('como funciona isso?', NOW);
  assert.deepEqual(result, { status: 'unsupported' });
});

await check('19. not_materializable -> unsupported', async () => {
  foundClarification({ resolveClarificationConversationalTurn: async () => ({ status: 'not_materializable' }) });
  const result = await handleConversationMessage('1 hora', NOW);
  assert.deepEqual(result, { status: 'unsupported' });
});

// ============================================================================
// 20-21. runtime_expired -> expired, zero NLU
// ============================================================================

await check('20. runtime_expired após found clarification -> expired, zero NLU', async () => {
  let nluCalls = 0;
  foundClarification({
    resolveClarificationConversationalTurn: async () => ({ status: 'runtime_expired' }),
    extractStructuredIntent: async () => {
      nluCalls++;
      throw new Error('não deveria ser chamado');
    },
  });
  const result = await handleConversationMessage('30 minutos', NOW);
  assert.deepEqual(result, { status: 'expired' });
  assert.equal(nluCalls, 0);
});

await check('21. runtime_expired após found proposal -> expired, zero NLU', async () => {
  foundProposal({ resolveProposalConversationalTurn: async () => ({ status: 'runtime_expired' }) });
  const result = await handleConversationMessage('sim', NOW);
  assert.deepEqual(result, { status: 'expired' });
});

// ============================================================================
// 22-23. wrong-kind -> conflict, zero handler cruzado, zero NLU
// ============================================================================

await check('22. proposal_pending -> conflict, zero proposal handler, zero NLU', async () => {
  foundClarification({ resolveClarificationConversationalTurn: async () => ({ status: 'proposal_pending' }) });
  const result = await handleConversationMessage('sim', NOW);
  assert.deepEqual(result, { status: 'conflict' });
});

await check('23. clarification_pending -> conflict, zero clarification handler, zero NLU', async () => {
  foundProposal({ resolveProposalConversationalTurn: async () => ({ status: 'clarification_pending' }) });
  const result = await handleConversationMessage('30 minutos', NOW);
  assert.deepEqual(result, { status: 'conflict' });
});

// ============================================================================
// 24-28. Corridas adicionais -> conflict
// ============================================================================

await check('24. no_active_runtime_state (clarification handler) -> conflict', async () => {
  foundClarification({ resolveClarificationConversationalTurn: async () => ({ status: 'no_active_runtime_state' }) });
  const result = await handleConversationMessage('30 minutos', NOW);
  assert.deepEqual(result, { status: 'conflict' });
});

await check('25. no_active_runtime_state (proposal handler) -> conflict', async () => {
  foundProposal({ resolveProposalConversationalTurn: async () => ({ status: 'no_active_runtime_state' }) });
  const result = await handleConversationMessage('sim', NOW);
  assert.deepEqual(result, { status: 'conflict' });
});

await check('26. first-turn already_active -> conflict', async () => {
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    extractStructuredIntent: async () => ({ status: 'extracted', intent: VALID_INTENT }),
    resolveFirstConversationalTurn: async () => ({ status: 'already_active' }),
  });
  const result = await handleConversationMessage('comprar leite amanhã', NOW);
  assert.deepEqual(result, { status: 'conflict' });
});

await check('27. clarification conflict -> conflict', async () => {
  foundClarification({ resolveClarificationConversationalTurn: async () => ({ status: 'conflict' }) });
  const result = await handleConversationMessage('30 minutos', NOW);
  assert.deepEqual(result, { status: 'conflict' });
});

await check('28. proposal conflict -> conflict', async () => {
  foundProposal({ resolveProposalConversationalTurn: async () => ({ status: 'conflict' }) });
  const result = await handleConversationMessage('sim', NOW);
  assert.deepEqual(result, { status: 'conflict' });
});

// ============================================================================
// 29-31. NLU
// ============================================================================

await check('29. NLU invalid -> needs_input, zero first-turn', async () => {
  let firstTurnCalls = 0;
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    extractStructuredIntent: async () => ({ status: 'invalid' }),
    resolveFirstConversationalTurn: async () => {
      firstTurnCalls++;
      throw new Error('não deveria ser chamado');
    },
  });
  const result = await handleConversationMessage('???', NOW);
  assert.deepEqual(result, { status: 'needs_input' });
  assert.equal(firstTurnCalls, 0);
});

await check('30. NLU error -> error, zero first-turn', async () => {
  let firstTurnCalls = 0;
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    extractStructuredIntent: async () => ({ status: 'error' }),
    resolveFirstConversationalTurn: async () => {
      firstTurnCalls++;
      throw new Error('não deveria ser chamado');
    },
  });
  const result = await handleConversationMessage('comprar leite amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
  assert.equal(firstTurnCalls, 0);
});

await check('31. NLU extracted -> first-turn recebe o intent exato (mesma referência)', async () => {
  let capturedIntent = null;
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    extractStructuredIntent: async () => ({ status: 'extracted', intent: VALID_INTENT }),
    resolveFirstConversationalTurn: async (intent) => {
      capturedIntent = intent;
      return { status: 'unsupported' };
    },
  });
  await handleConversationMessage('comprar leite amanhã', NOW);
  assert.equal(capturedIntent, VALID_INTENT);
});

// ============================================================================
// 32-34. `now` propagado sem alteração
// ============================================================================

await check('32. first-turn recebe o MESMO now', async () => {
  let capturedNow = null;
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    extractStructuredIntent: async () => ({ status: 'extracted', intent: VALID_INTENT }),
    resolveFirstConversationalTurn: async (intent, now) => {
      capturedNow = now;
      return { status: 'unsupported' };
    },
  });
  await handleConversationMessage('comprar leite amanhã', NOW);
  assert.equal(capturedNow, NOW);
});

await check('33. clarification-turn recebe o MESMO now', async () => {
  let capturedNow = null;
  foundClarification({
    resolveClarificationConversationalTurn: async (answer, now) => {
      capturedNow = now;
      return { status: 'ambiguous' };
    },
  });
  await handleConversationMessage('30 minutos', NOW);
  assert.equal(capturedNow, NOW);
});

await check('34. proposal-turn recebe o MESMO now', async () => {
  let capturedNow = null;
  foundProposal({
    resolveProposalConversationalTurn: async (answer, now) => {
      capturedNow = now;
      return { status: 'confirmation_ambiguous' };
    },
  });
  await handleConversationMessage('talvez', NOW);
  assert.equal(capturedNow, NOW);
});

// ============================================================================
// 35-36. TTLs distintos corretos
// ============================================================================

await check('35. clarification-turn recebe clarificationExpiresAt (24h) e proposalExpiresAt (30min) corretos', async () => {
  let capturedExpirations = null;
  foundClarification({
    resolveClarificationConversationalTurn: async (answer, now, expirations) => {
      capturedExpirations = expirations;
      return { status: 'ambiguous' };
    },
  });
  await handleConversationMessage('30 minutos', NOW);
  assert.equal(capturedExpirations.clarificationExpiresAt, EXPECTED_CLARIFICATION_EXPIRES_AT);
  assert.equal(capturedExpirations.proposalExpiresAt, EXPECTED_PROPOSAL_EXPIRES_AT);
  assert.notEqual(capturedExpirations.clarificationExpiresAt, capturedExpirations.proposalExpiresAt);
});

await check('36. first-turn recebe os mesmos dois TTLs corretos', async () => {
  let capturedExpirations = null;
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    extractStructuredIntent: async () => ({ status: 'extracted', intent: VALID_INTENT }),
    resolveFirstConversationalTurn: async (intent, now, expirations) => {
      capturedExpirations = expirations;
      return { status: 'unsupported' };
    },
  });
  await handleConversationMessage('comprar leite amanhã', NOW);
  assert.equal(capturedExpirations.clarificationExpiresAt, EXPECTED_CLARIFICATION_EXPIRES_AT);
  assert.equal(capturedExpirations.proposalExpiresAt, EXPECTED_PROPOSAL_EXPIRES_AT);
});

// ============================================================================
// 37-39. Zero fallback / regra de autorização de NLU (reafirmação explícita)
// ============================================================================

await check(
  '37 e 38. wrong-kind nunca dispara fallback nem NLU (proposal_pending não chama proposal-turn/NLU)',
  async () => {
    // resolveProposalConversationalTurn e extractStructuredIntent
    // permanecem "neverCalled" — se o dispatcher tentasse qualquer
    // fallback, o teste falharia com exceção em vez do `conflict`
    // esperado.
    foundClarification({ resolveClarificationConversationalTurn: async () => ({ status: 'proposal_pending' }) });
    const result = await handleConversationMessage('sim', NOW);
    assert.deepEqual(result, { status: 'conflict' });
  },
);

await check('39. NLU só ocorre com initial not_found/expired (nunca com found)', async () => {
  // Já provado estruturalmente pelos testes 4/5 (found clarification/found
  // proposal nunca chamam extractStructuredIntent, que permanece
  // "neverCalled" nesses testes) — reafirmado aqui com um terceiro caso.
  let nluCalls = 0;
  foundProposal({
    resolveProposalConversationalTurn: async () => ({ status: 'cancelled' }),
    extractStructuredIntent: async () => {
      nluCalls++;
      throw new Error('não deveria ser chamado');
    },
  });
  await handleConversationMessage('não', NOW);
  assert.equal(nluCalls, 0);
});

// ============================================================================
// 40-42. Integridade de dados / segurança do DTO
// ============================================================================

await check('40. action retornada é a MESMA referência fornecida pelo turn handler', async () => {
  foundClarification({
    resolveClarificationConversationalTurn: async () => ({ status: 'proposal_saved', action: VALID_ACTION }),
  });
  const result = await handleConversationMessage('30 minutos', NOW);
  assert.equal(result.action, VALID_ACTION);
});

await check('41. itemId é repassado sem transformação', async () => {
  foundProposal({
    resolveProposalConversationalTurn: async () => ({ status: 'confirmed', itemId: 'distinctive-item-id-999' }),
  });
  const result = await handleConversationMessage('sim', NOW);
  assert.equal(result.itemId, 'distinctive-item-id-999');
});

await check('42. zero ids internos em qualquer resultado do DTO', async () => {
  const scenarios = [
    () => {
      foundClarification({
        resolveClarificationConversationalTurn: async () => ({ status: 'clarification_saved', question: 'x' }),
      });
    },
    () => {
      foundClarification({
        resolveClarificationConversationalTurn: async () => ({ status: 'proposal_saved', action: VALID_ACTION }),
      });
    },
    () => {
      foundProposal({ resolveProposalConversationalTurn: async () => ({ status: 'confirmed', itemId: 'x' }) });
    },
  ];
  for (const setup of scenarios) {
    setup();
    const result = await handleConversationMessage('x', NOW);
    const keys = Object.keys(result);
    assert.ok(!keys.includes('stateId'));
    assert.ok(!keys.includes('proposalId'));
    assert.ok(!keys.includes('userId'));
  }
});

// ============================================================================
// 43. NENHUMA CHAMADA EXTRA A getRuntimeState DENTRO DO ENTRY
// ============================================================================

await check('43a. found clarification -> getRuntimeState chamado exatamente 1 vez (no entry)', async () => {
  let getCalls = 0;
  foundClarification({
    getRuntimeState: async () => {
      getCalls++;
      return { status: 'found', value: { stateId: 'c1', kind: 'clarification', state: {} } };
    },
    resolveClarificationConversationalTurn: async () => ({ status: 'ambiguous' }),
  });
  await handleConversationMessage('30 minutos', NOW);
  assert.equal(getCalls, 1);
});

await check('43b. not_found -> getRuntimeState chamado exatamente 1 vez (no entry)', async () => {
  let getCalls = 0;
  setHandlers({
    getRuntimeState: async () => {
      getCalls++;
      return { status: 'not_found' };
    },
    extractStructuredIntent: async () => ({ status: 'invalid' }),
  });
  await handleConversationMessage('comprar leite amanhã', NOW);
  assert.equal(getCalls, 1);
});

// ============================================================================
// 44-45. Corrida absence -> active não tenta novamente
// ============================================================================

await check('44. initial not_found + first-turn already_active -> conflict, sem segunda tentativa', async () => {
  let nluCalls = 0;
  let firstTurnCalls = 0;
  let getCalls = 0;
  setHandlers({
    getRuntimeState: async () => {
      getCalls++;
      return { status: 'not_found' };
    },
    extractStructuredIntent: async () => {
      nluCalls++;
      return { status: 'extracted', intent: VALID_INTENT };
    },
    resolveFirstConversationalTurn: async () => {
      firstTurnCalls++;
      return { status: 'already_active' };
    },
  });
  const result = await handleConversationMessage('comprar leite amanhã', NOW);
  assert.deepEqual(result, { status: 'conflict' });
  assert.equal(getCalls, 1);
  assert.equal(nluCalls, 1);
  assert.equal(firstTurnCalls, 1);
});

await check('45. initial expired + first-turn already_active -> conflict, sem segunda tentativa', async () => {
  let nluCalls = 0;
  let firstTurnCalls = 0;
  setHandlers({
    getRuntimeState: async () => ({ status: 'expired' }),
    extractStructuredIntent: async () => {
      nluCalls++;
      return { status: 'extracted', intent: VALID_INTENT };
    },
    resolveFirstConversationalTurn: async () => {
      firstTurnCalls++;
      return { status: 'already_active' };
    },
  });
  const result = await handleConversationMessage('comprar leite amanhã', NOW);
  assert.deepEqual(result, { status: 'conflict' });
  assert.equal(nluCalls, 1);
  assert.equal(firstTurnCalls, 1);
});

// ============================================================================
// AUDITORIA ESTÁTICA DO ARQUIVO-FONTE
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/conversation-entry.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

await check('46. módulo é server-only', () => {
  assert.ok(codeOnly.includes("import 'server-only'"));
});

await check('47. zero Supabase/admin/service_role/Anthropic/fetch/process.env/items no código real', () => {
  const forbidden = [
    'supabase',
    'Supabase',
    'createAdminClient',
    'service_role',
    'SUPABASE_SECRET_KEY',
    'Anthropic',
    'fetch(',
    'process.env',
    'RPC',
    'from(\'items\')',
    'items.insert',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

await check('47b. único import de Calendar é o type CalendarQueryResult (fronteira já traduzida por conversation-turn), zero acesso direto à API do Google', () => {
  assert.ok(codeOnly.includes("import type { CalendarQueryResult } from './calendar-query'"));
  const forbidden = [
    'getGoogleCalendarBusyTimes',
    "from '../google/calendar'",
    "from '@/lib/google/calendar'",
    'googleapis.com',
    'freeBusy',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `acesso direto à API do Google encontrado: ${token}`);
  }
});

await check('48. API pública não recebe userId/stateId/proposalId/client/ProposalState/ConversationState', () => {
  const signatureMatch = codeOnly.match(/export async function handleConversationMessage\(([^)]*)\)/s);
  assert.ok(signatureMatch, 'assinatura pública não encontrada');
  const params = signatureMatch[1];
  assert.ok(!/userId/i.test(params));
  assert.ok(!/stateId/i.test(params));
  assert.ok(!/proposalId/i.test(params));
  assert.ok(!/supabase/i.test(params));
  assert.ok(!/ConversationState/.test(params));
  assert.ok(!/ProposalState/.test(params));
  assert.ok(!/deps/i.test(params));
});

await check('49. usa as abstrações reais (imports estáticos), nunca reimplementa lógica', () => {
  assert.ok(codeOnly.includes("from './runtime-state-storage'"));
  assert.ok(codeOnly.includes("from './conversation-turn'"));
  assert.ok(codeOnly.includes("from './proposal-turn'"));
  assert.ok(codeOnly.includes("from './intent-extraction'"));
  assert.ok(codeOnly.includes("from './conversation-ttl'"));
});

// ============================================================================
// 50-54. query_calendar read-only — calendar_information, timezone
// ============================================================================

const CALENDAR_RESULT = { status: 'busy', scope: 'hour', busyBlockCount: 1 };
const TIMEZONE = 'America/Sao_Paulo';

await check('50. first-turn calendar_information -> traduzido verbatim, result é a MESMA referência', async () => {
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    extractStructuredIntent: async () => ({ status: 'extracted', intent: VALID_INTENT }),
    resolveFirstConversationalTurn: async () => ({ status: 'calendar_information', result: CALENDAR_RESULT }),
  });
  const result = await handleConversationMessage('tenho algo amanhã?', NOW, TIMEZONE);
  assert.deepEqual(result, { status: 'calendar_information', result: CALENDAR_RESULT });
  assert.equal(result.result, CALENDAR_RESULT);
});

await check('51. clarification calendar_information -> traduzido verbatim', async () => {
  foundClarification({
    resolveClarificationConversationalTurn: async () => ({ status: 'calendar_information', result: CALENDAR_RESULT }),
  });
  const result = await handleConversationMessage('amanhã', NOW, TIMEZONE);
  assert.deepEqual(result, { status: 'calendar_information', result: CALENDAR_RESULT });
});

await check('52. timezone propagada verbatim para resolveFirstConversationalTurn (4º argumento)', async () => {
  let capturedTimezone = null;
  setHandlers({
    getRuntimeState: async () => ({ status: 'not_found' }),
    extractStructuredIntent: async () => ({ status: 'extracted', intent: VALID_INTENT }),
    resolveFirstConversationalTurn: async (intent, now, expirations, timezone) => {
      capturedTimezone = timezone;
      return { status: 'unsupported' };
    },
  });
  await handleConversationMessage('comprar leite amanhã', NOW, TIMEZONE);
  assert.equal(capturedTimezone, TIMEZONE);
});

await check('53. timezone propagada verbatim para resolveClarificationConversationalTurn (4º argumento)', async () => {
  let capturedTimezone = null;
  foundClarification({
    resolveClarificationConversationalTurn: async (answer, now, expirations, timezone) => {
      capturedTimezone = timezone;
      return { status: 'ambiguous' };
    },
  });
  await handleConversationMessage('30 minutos', NOW, TIMEZONE);
  assert.equal(capturedTimezone, TIMEZONE);
});

await check('54. now continua exato e timezone nunca afeta o roteamento inicial (initial GET agnóstico a timezone)', async () => {
  let getCalls = 0;
  foundProposal({
    getRuntimeState: async () => {
      getCalls++;
      return { status: 'found', value: { stateId: 'proposal-1', kind: 'proposal', state: {} } };
    },
    resolveProposalConversationalTurn: async () => ({ status: 'cancelled' }),
  });
  const result = await handleConversationMessage('não', NOW, 'Not/AValidTimeZone');
  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(getCalls, 1);
});

// ============================================================================
// 55-56. create_event — schedule_conflict / calendar_unavailable (Subfase 2
// da criação de compromissos no Google Calendar)
// ============================================================================

await check('55. first-turn schedule_conflict/calendar_unavailable -> traduzidos verbatim (mesmo nome nas duas camadas)', async () => {
  for (const status of ['schedule_conflict', 'calendar_unavailable']) {
    setHandlers({
      getRuntimeState: async () => ({ status: 'not_found' }),
      extractStructuredIntent: async () => ({ status: 'extracted', intent: VALID_INTENT }),
      resolveFirstConversationalTurn: async () => ({ status }),
    });
    const result = await handleConversationMessage('reunião amanhã às 14h', NOW, TIMEZONE);
    assert.deepEqual(result, { status });
  }
});

await check('56. clarification schedule_conflict/calendar_unavailable -> traduzidos verbatim', async () => {
  for (const status of ['schedule_conflict', 'calendar_unavailable']) {
    foundClarification({
      resolveClarificationConversationalTurn: async () => ({ status }),
    });
    const result = await handleConversationMessage('1 hora', NOW, TIMEZONE);
    assert.deepEqual(result, { status });
  }
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
