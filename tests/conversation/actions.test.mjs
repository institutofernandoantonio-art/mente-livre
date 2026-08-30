// Testes unitários de src/lib/conversation/actions.ts (Server Action
// pública `sendConversationMessage`).
//
// Execução: npm run test:conversation-actions
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão de
// tests/conversation/conversation-entry.test.mjs. Importa a Server Action
// REAL, com `handleConversationMessage` substituído por um dublê via o
// hook de resolução em tests/support/ (conversation-entry.ts é a única
// dependência de src/lib/conversation/ que actions.ts importa) — testamos
// SÓ a transport boundary (delegação, `now` server-side, texto preservado,
// retorno direto, catch), nunca a lógica interna do dispatcher (já coberta
// por conversation-entry.test.mjs).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sendConversationMessage } from '../../src/lib/conversation/actions.ts';
import { handlers } from '../support/fake-conversation-entry.mjs';

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

// Reconfigura o dublê antes de cada teste — nunca deixa handler de um teste
// anterior vazar para o próximo.
function setHandler(fn) {
  handlers.handleConversationMessage = fn ?? neverCalled('handleConversationMessage');
}

const FIXED_NOW = 1_700_000_000_000;

// Monkeypatch de Date.now — só neste processo de teste, nunca uma mudança
// na API de produção. Sempre restaurado em `finally`, mesmo se a asserção
// dentro de `fn` lançar.
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
// 1-2. DELEGAÇÃO / `now` SERVER-SIDE
// ============================================================================

await check('1. delega para handleConversationMessage exatamente 1 vez, com o texto recebido', async () => {
  let calls = 0;
  let capturedArgs = null;
  setHandler(async (...args) => {
    calls++;
    capturedArgs = args;
    return { status: 'needs_input' };
  });

  await withFixedNow(async () => {
    await sendConversationMessage('comprar leite amanhã');
  });

  assert.equal(calls, 1);
  assert.equal(capturedArgs[0], 'comprar leite amanhã');
});

await check('2. now é gerado no servidor via Date.now(), nunca recebido de fora', async () => {
  let capturedNow = null;
  setHandler(async (text, now) => {
    capturedNow = now;
    return { status: 'needs_input' };
  });

  await withFixedNow(async () => {
    await sendConversationMessage('qualquer texto');
  });

  assert.equal(capturedNow, FIXED_NOW);
});

// ============================================================================
// 3. TEXTO PRESERVADO SEM TRANSFORMAÇÃO
// ============================================================================

await check('3. texto com espaços/acentos/pontuação atravessa exatamente como recebido', async () => {
  const RAW_TEXT = '   Terminar relatório às 15h, por favor!!!   ';
  let capturedText = null;
  setHandler(async (text) => {
    capturedText = text;
    return { status: 'needs_input' };
  });

  await sendConversationMessage(RAW_TEXT);

  // Comparação estrita — nenhum trim/normalização/coerção pode ter ocorrido
  // entre o parâmetro e a chamada ao dispatcher.
  assert.equal(capturedText, RAW_TEXT);
});

// ============================================================================
// 4. RETORNO DIRETO — TODOS OS 9 STATUS DO DTO, SEM RECONSTRUÇÃO
// ============================================================================

const DTO_SCENARIOS = [
  { status: 'clarification_required', question: 'Quanto tempo você quer reservar?' },
  { status: 'proposal_ready', action: VALID_ACTION },
  { status: 'confirmed', itemId: 'item-uuid-123' },
  { status: 'cancelled' },
  { status: 'needs_input' },
  { status: 'unsupported' },
  { status: 'conflict' },
  { status: 'expired' },
  { status: 'error' },
];

for (const dto of DTO_SCENARIOS) {
  await check(`4. status '${dto.status}' -> devolvido sem reconstrução semântica`, async () => {
    setHandler(async () => dto);
    const result = await sendConversationMessage('texto qualquer');
    assert.deepEqual(result, dto);
  });
}

await check("4b. 'proposal_ready'.action é a MESMA referência devolvida pelo dispatcher", async () => {
  setHandler(async () => ({ status: 'proposal_ready', action: VALID_ACTION }));
  const result = await sendConversationMessage('texto qualquer');
  assert.equal(result.action, VALID_ACTION);
});

// ============================================================================
// 5. THROW INESPERADO -> { status: 'error' }, EXCEPTION NÃO ESCAPA
// ============================================================================

await check('5. exception do dispatcher -> { status: "error" }, exatamente 1 chamada', async () => {
  let calls = 0;
  setHandler(async () => {
    calls++;
    throw new Error('falha inesperada simulada');
  });

  const result = await sendConversationMessage('texto qualquer');

  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls, 1);
});

// ============================================================================
// AUDITORIA ESTÁTICA DO ARQUIVO-FONTE
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/actions.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

await check('6. módulo é uma Server Action ("use server"), sem duplicar auth/Supabase', () => {
  assert.ok(codeOnly.includes("'use server'"));
  const forbidden = [
    'createClient',
    'getClaims',
    'getUser',
    'userId',
    'Supabase',
    'supabase',
    'service_role',
    'createAdminClient',
    'admin',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

await check('7. importa SOMENTE ./conversation-entry de src/lib/conversation/ (zero business logic direta)', () => {
  const forbiddenImports = [
    'runtime-state-storage',
    'intent-extraction',
    'conversation-turn',
    'proposal-turn',
    'conversation-ttl',
    'confirmation',
    'local-task-execution',
  ];
  for (const token of forbiddenImports) {
    assert.ok(!codeOnly.includes(token), `import proibido encontrado: ${token}`);
  }
  assert.ok(codeOnly.includes("from './conversation-entry'"));
});

await check("8. assinatura pública aceita SÓ 'text: string' — sem now/ids internos como parâmetro", () => {
  // Escopo deliberadamente restrito à LISTA DE PARÂMETROS da função
  // exportada — nunca ao arquivo inteiro, onde `Date.now()` aparece
  // legitimamente no corpo (ver comentário do cabeçalho da action) e
  // geraria falso positivo num grep ingênuo por "now".
  const signatureMatch = codeOnly.match(/export async function sendConversationMessage\(([^)]*)\)/s);
  assert.ok(signatureMatch, 'assinatura pública não encontrada');
  const params = signatureMatch[1].trim();

  assert.equal(params, 'text: string', 'assinatura deve ter exatamente um parâmetro: text: string');
  assert.ok(!/\bnow\b/i.test(params));
  assert.ok(!/stateId/i.test(params));
  assert.ok(!/proposalId/i.test(params));
  assert.ok(!/expiresAt/i.test(params));
  assert.ok(!/StructuredIntent/.test(params));
  assert.ok(!/ConversationState/.test(params));
  assert.ok(!/ProposalState/.test(params));
});

await check('9. Date.now() aparece legitimamente no corpo (gera o now server-side)', () => {
  assert.ok(codeOnly.includes('Date.now()'));
});

await check('10. catch estreito envolve SOMENTE a chamada ao dispatcher', () => {
  const bodyMatch = codeOnly.match(
    /export async function sendConversationMessage\([^)]*\)\s*:\s*Promise<ConversationEntryResult>\s*{([\s\S]*)}\s*$/,
  );
  assert.ok(bodyMatch, 'corpo da função pública não encontrado');
  const body = bodyMatch[1];
  assert.ok(/try\s*{\s*return await handleConversationMessage\(text, now\);\s*}\s*catch/.test(body));
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
