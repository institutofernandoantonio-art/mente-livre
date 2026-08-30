// Testes unitários de src/lib/conversation/presentation.ts (Server Function
// pública read-only `getConversationPresentationState`).
//
// Execução: npm run test:conversation-presentation
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão dos demais
// testes de src/lib/conversation/. Importa a Server Function REAL, com
// `getRuntimeState` substituído pelo dublê JÁ EXISTENTE
// (fake-runtime-state-storage.mjs), redirecionado pelo loader já existente
// (`./runtime-state-storage`, mesmo specifier já usado por
// conversation-turn.ts/local-task-execution.ts/proposal-turn.ts) — nenhum
// dublê novo, nenhuma alteração de loader.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getConversationPresentationState } from '../../src/lib/conversation/presentation.ts';
import { handlers } from '../support/fake-runtime-state-storage.mjs';

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

// Reconfigura o dublê antes de cada teste — só `getRuntimeState` é
// relevante aqui; `replace`/`advance`/`consume` permanecem "neverCalled"
// em todo teste, provando o caráter read-only desta camada.
function setHandlers(overrides = {}) {
  handlers.getRuntimeState = overrides.getRuntimeState ?? neverCalled('getRuntimeState');
  handlers.replaceRuntimeState = neverCalled('replaceRuntimeState');
  handlers.advanceRuntimeState = neverCalled('advanceRuntimeState');
  handlers.consumeRuntimeState = neverCalled('consumeRuntimeState');
}

const FIXED_NOW = 1_700_000_000_000;

async function withFixedNow(fn) {
  const originalNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    await fn();
  } finally {
    Date.now = originalNow;
  }
}

const VALID_ACTION = {
  actionType: 'create_local_task',
  task: { title: 'Revisar orçamento', description: null, deadline: null, duration: null },
};

// ============================================================================
// 1-4. MAPPING BÁSICO
// ============================================================================

await check('1. not_found -> { status: "empty" }, 1 chamada', async () => {
  let calls = 0;
  setHandlers({
    getRuntimeState: async () => {
      calls++;
      return { status: 'not_found' };
    },
  });
  const result = await getConversationPresentationState();
  assert.deepEqual(result, { status: 'empty' });
  assert.equal(calls, 1);
});

await check('2. expired -> { status: "expired" }', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'expired' }) });
  const result = await getConversationPresentationState();
  assert.deepEqual(result, { status: 'expired' });
});

await check('3. error -> { status: "error" }', async () => {
  setHandlers({ getRuntimeState: async () => ({ status: 'error' }) });
  const result = await getConversationPresentationState();
  assert.deepEqual(result, { status: 'error' });
});

await check('4. throw inesperado -> { status: "error" }, exception não escapa, 1 chamada', async () => {
  let calls = 0;
  setHandlers({
    getRuntimeState: async () => {
      calls++;
      throw new Error('falha inesperada simulada');
    },
  });
  const result = await getConversationPresentationState();
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls, 1);
});

// ============================================================================
// 5. CLARIFICATION — SÓ question, ZERO METADADO INTERNO
// ============================================================================

await check('5. found/clarification -> { status: "clarification_required", question }, zero campo extra', async () => {
  setHandlers({
    getRuntimeState: async () => ({
      status: 'found',
      value: {
        stateId: 'state-id-nunca-deve-vazar',
        kind: 'clarification',
        state: {
          status: 'awaiting_clarification',
          pendingIntent: { intentType: 'create_task', missingFields: ['duration'], confidence: 0.8 },
          currentQuestion: { field: 'duration', text: 'Quanto tempo você quer reservar?' },
          createdAt: FIXED_NOW - 60_000,
          expiresAt: FIXED_NOW + 60_000,
        },
      },
    }),
  });

  const result = await getConversationPresentationState();

  assert.deepEqual(result, {
    status: 'clarification_required',
    question: 'Quanto tempo você quer reservar?',
  });
  // Contrato exportado tem só 2 chaves neste status — nenhum campo interno
  // (stateId/intent/missingFields/attempts/expiresAt) pode ter vazado.
  assert.deepEqual(Object.keys(result).sort(), ['question', 'status']);
});

// ============================================================================
// 6. PROPOSAL — SÓ action, ZERO METADADO INTERNO
// ============================================================================

await check(
  '6. found/proposal -> { status: "proposal_ready", action }, mesma referência, zero proposalId/expiresAt/stateId',
  async () => {
    setHandlers({
      getRuntimeState: async () => ({
        status: 'found',
        value: {
          stateId: 'state-id-nunca-deve-vazar',
          kind: 'proposal',
          state: {
            status: 'awaiting_confirmation',
            proposalId: 'proposal-id-nunca-deve-vazar',
            action: VALID_ACTION,
            createdAt: FIXED_NOW - 60_000,
            expiresAt: FIXED_NOW + 60_000,
          },
        },
      }),
    });

    const result = await getConversationPresentationState();

    assert.equal(result.status, 'proposal_ready');
    assert.equal(result.action, VALID_ACTION);
    assert.deepEqual(Object.keys(result).sort(), ['action', 'status']);
  },
);

// ============================================================================
// 7. NOW SERVER-SIDE
// ============================================================================

await check('7. now é gerado no servidor via Date.now(), nunca recebido de fora', async () => {
  let capturedNow = null;
  setHandlers({
    getRuntimeState: async (now) => {
      capturedNow = now;
      return { status: 'not_found' };
    },
  });

  await withFixedNow(async () => {
    await getConversationPresentationState();
  });

  assert.equal(capturedNow, FIXED_NOW);
});

// ============================================================================
// AUDITORIA ESTÁTICA DO ARQUIVO-FONTE
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/presentation.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

await check('8. assinatura pública não tem NENHUM parâmetro', () => {
  const signatureMatch = codeOnly.match(/export async function getConversationPresentationState\(([^)]*)\)/s);
  assert.ok(signatureMatch, 'assinatura pública não encontrada');
  assert.equal(signatureMatch[1].trim(), '', 'assinatura deve ter exatamente zero parâmetros');
});

await check('9. Date.now() aparece legitimamente no corpo', () => {
  assert.ok(codeOnly.includes('Date.now()'));
});

await check('10. read-only: nenhuma mutação/dispatcher/turn-handler/NLU/Confirmation/Execution', () => {
  const forbidden = [
    'replaceRuntimeState',
    'advanceRuntimeState',
    'consumeRuntimeState',
    'handleConversationMessage',
    'resolveFirstConversationalTurn',
    'resolveClarificationConversationalTurn',
    'resolveProposalConversationalTurn',
    'extractStructuredIntent',
    'resolveProposalConfirmation',
    'executeCreateLocalTask',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
  // Único import de runtime: getRuntimeState de ./runtime-state-storage.
  assert.ok(codeOnly.includes("import { getRuntimeState } from './runtime-state-storage'"));
});

await check('11. zero auth duplicada / zero Supabase / zero provider externo', () => {
  const forbidden = [
    'createClient',
    'getClaims',
    'getUser',
    'Supabase',
    'supabase',
    'service_role',
    'admin',
    'process.env',
    'fetch(',
    'Anthropic',
    "from('items')",
    'Calendar',
    '.rpc(',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

await check('12. DTO exportado tem exatamente os 5 status esperados, sem ids internos nos literais', () => {
  const dtoMatch = codeOnly.match(/export type ConversationPresentationState =([\s\S]*?);\n\nexport async function/);
  assert.ok(dtoMatch, 'tipo ConversationPresentationState não encontrado');
  const dtoBody = dtoMatch[1];

  for (const status of ['empty', 'clarification_required', 'proposal_ready', 'expired', 'error']) {
    assert.ok(dtoBody.includes(`'${status}'`), `status ausente no DTO: ${status}`);
  }
  // Auditoria sobre a DEFINIÇÃO DE TIPO em si (união de literais), não uma
  // substring solta no arquivo inteiro (que conteria comentários
  // mencionando esses termos por auditoria) — evita falso positivo.
  for (const forbiddenField of ['stateId', 'proposalId', 'userId', 'expiresAt']) {
    assert.ok(!dtoBody.includes(forbiddenField), `campo proibido no DTO: ${forbiddenField}`);
  }
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
