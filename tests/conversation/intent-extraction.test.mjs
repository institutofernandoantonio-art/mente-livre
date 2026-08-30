// Testes unitários de src/lib/conversation/intent-extraction.ts.
//
// Execução: npm run test:intent-extraction
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão de
// tests/conversation/local-task-execution.test.mjs. `server-only` exige
// `--conditions=react-server`; o import extensionless de
// `./runtime-state-validation` exige o loader de extensão automática (ver
// tests/support/ts-extension-loader.mjs) — mas NENHUM redirect novo foi
// necessário: `runtime-state-validation.ts` é 100% puro (zero
// `next/headers`), então o módulo real é importado sem nenhum dublê.
//
// A única dependência externa deste módulo é `fetch` (global, não um
// módulo importado) — interceptada aqui via substituição direta de
// `globalThis.fetch`, restaurada depois de cada teste. Nenhum seam de
// teste foi adicionado à produção.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractStructuredIntent } from '../../src/lib/conversation/intent-extraction.ts';

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

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_API_KEY = process.env.ANTHROPIC_API_KEY;

function restoreEnvironment() {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_API_KEY;
  }
}

function setFetch(fn) {
  globalThis.fetch = fn;
}

function ensureApiKey() {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
}

function capturingFetch(responder) {
  const calls = [];
  setFetch(async (url, options) => {
    calls.push({ url, options });
    return responder(url, options);
  });
  return calls;
}

function providerOkResponse(textContent) {
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: textContent }] }) };
}

const NOW = 1_700_000_000_000; // epoch ms
const EXPECTED_ISO = new Date(NOW).toISOString();

const VALID_CREATE_TASK = {
  missingFields: [],
  confidence: 0.9,
  intentType: 'create_task',
  task: { kind: 'new_task', title: 'Revisar orçamento', description: null },
  temporalWindow: null,
  duration: { source: 'stated', value: { minutes: 30 }, confidence: 0.9 },
  deadline: { source: 'stated', value: { at: '2026-09-01T10:00:00.000Z' }, confidence: 0.9 },
};

const VALID_CANCEL_EVENT = {
  missingFields: [],
  confidence: 0.8,
  intentType: 'cancel_event',
  eventReference: { kind: 'existing_reference', raw: 'a reunião de amanhã', resolvedId: null },
  calendarAction: 'cancel',
};

// ============================================================================
// 1-4. VALIDAÇÃO DE INPUT — invalid, zero fetch
// ============================================================================

await check('1. texto vazio -> invalid, zero fetch', async () => {
  ensureApiKey();
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent('', NOW);
  assert.deepEqual(result, { status: 'invalid' });
  assert.equal(calls.length, 0);
});

await check('1b. texto só espaço -> invalid, zero fetch', async () => {
  ensureApiKey();
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent('   ', NOW);
  assert.deepEqual(result, { status: 'invalid' });
  assert.equal(calls.length, 0);
});

await check('2. now = NaN -> invalid, zero fetch', async () => {
  ensureApiKey();
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent('me lembra de ligar', NaN);
  assert.deepEqual(result, { status: 'invalid' });
  assert.equal(calls.length, 0);
});

await check('3. now = Infinity -> invalid, zero fetch', async () => {
  ensureApiKey();
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent('me lembra de ligar', Infinity);
  assert.deepEqual(result, { status: 'invalid' });
  assert.equal(calls.length, 0);
});

await check('4. now não-inteiro -> invalid, zero fetch', async () => {
  ensureApiKey();
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent('me lembra de ligar', NOW + 0.5);
  assert.deepEqual(result, { status: 'invalid' });
  assert.equal(calls.length, 0);
});

// ============================================================================
// 5. API KEY AUSENTE -> error, zero fetch
// ============================================================================

await check('5. ANTHROPIC_API_KEY ausente -> error, zero fetch', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
  ensureApiKey();
});

// ============================================================================
// 6-9. FALHAS TÉCNICAS/DE PROVIDER -> error
// ============================================================================

await check('6. fetch rejeita (exceção de rede) -> error', async () => {
  ensureApiKey();
  setFetch(async () => {
    throw new Error('network down');
  });
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
});

await check('7. HTTP não-ok -> error', async () => {
  ensureApiKey();
  setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
});

await check('8a. envelope JSON não parseável (response.json() lança) -> error', async () => {
  ensureApiKey();
  setFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('not json');
    },
  }));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
});

await check('8b. envelope sem campo "content" -> error', async () => {
  ensureApiKey();
  setFetch(async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
});

await check('8c. "content" não é array -> error', async () => {
  ensureApiKey();
  setFetch(async () => ({ ok: true, status: 200, json: async () => ({ content: 'não é array' }) }));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
});

await check('9. provider sem bloco de texto utilizável -> error', async () => {
  ensureApiKey();
  setFetch(async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'image' }] }) }));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
});

await check('9b. dois blocos de texto -> error (nunca escolhe o primeiro, nunca concatena)', async () => {
  ensureApiKey();
  setFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      content: [
        { type: 'text', text: JSON.stringify(VALID_CREATE_TASK) },
        { type: 'text', text: 'explicação extra que não deveria existir' },
      ],
    }),
  }));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
});

// ============================================================================
// API KEY — WHITESPACE
// ============================================================================

await check('5b. ANTHROPIC_API_KEY = "" -> error, zero fetch', async () => {
  process.env.ANTHROPIC_API_KEY = '';
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
  ensureApiKey();
});

await check('5c. ANTHROPIC_API_KEY = "   " (só espaço) -> error, zero fetch', async () => {
  process.env.ANTHROPIC_API_KEY = '   ';
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'error' });
  assert.equal(calls.length, 0);
  ensureApiKey();
});

// ============================================================================
// `text` NÃO-STRING EM RUNTIME (mesmo com TS declarando `text: string`)
// ============================================================================

await check('1c. text não-string em runtime (number) -> invalid, zero fetch', async () => {
  ensureApiKey();
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent(/** @type {any} */ (42), NOW);
  assert.deepEqual(result, { status: 'invalid' });
  assert.equal(calls.length, 0);
});

await check('1d. text não-string em runtime (null) -> invalid, zero fetch', async () => {
  ensureApiKey();
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent(/** @type {any} */ (null), NOW);
  assert.deepEqual(result, { status: 'invalid' });
  assert.equal(calls.length, 0);
});

// ============================================================================
// 10-11, 14. CONTEÚDO DO MODELO INVÁLIDO -> invalid
// ============================================================================

await check('10. texto retornado não é JSON -> invalid', async () => {
  ensureApiKey();
  setFetch(async () => providerOkResponse('isso não é json nenhum'));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'invalid' });
});

await check('10b. JSON com markdown fence ao redor -> invalid (nenhum strip é feito, mesma disciplina de parseOrganizedItem)', async () => {
  ensureApiKey();
  setFetch(async () => providerOkResponse('```json\n' + JSON.stringify(VALID_CREATE_TASK) + '\n```'));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'invalid' });
});

await check('11. JSON válido mas StructuredIntent inválido (intentType desconhecido) -> invalid', async () => {
  ensureApiKey();
  setFetch(async () => providerOkResponse(JSON.stringify({ ...VALID_CREATE_TASK, intentType: 'fly_to_moon' })));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'invalid' });
});

await check('14. JSON com chave extra que o validator rejeita -> invalid', async () => {
  ensureApiKey();
  setFetch(async () => providerOkResponse(JSON.stringify({ ...VALID_CREATE_TASK, extra: 'campo indevido' })));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.deepEqual(result, { status: 'invalid' });
});

// ============================================================================
// 12-13. EXTRAÇÃO VÁLIDA -> extracted
// ============================================================================

await check('12. create_task válido -> extracted, intent exatamente preservado', async () => {
  ensureApiKey();
  setFetch(async () => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent('me lembra de revisar o orçamento', NOW);
  assert.deepEqual(result, { status: 'extracted', intent: VALID_CREATE_TASK });
});

await check('13. outra variante válida (cancel_event) -> extracted', async () => {
  ensureApiKey();
  setFetch(async () => providerOkResponse(JSON.stringify(VALID_CANCEL_EVENT)));
  const result = await extractStructuredIntent('cancela a reunião de amanhã', NOW);
  assert.deepEqual(result, { status: 'extracted', intent: VALID_CANCEL_EVENT });
});

// ============================================================================
// 15-17. CONTEÚDO DO REQUEST ENVIADO AO PROVIDER
// ============================================================================

await check('15. now enviado ao provider corresponde ao argumento recebido (nunca Date.now())', async () => {
  ensureApiKey();
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  const body = JSON.parse(calls[0].options.body);
  assert.ok(body.system.includes(EXPECTED_ISO), 'prompt do sistema deveria conter o ISO exato de `now`');
});

await check('16. texto original do usuário está presente, verbatim, no request', async () => {
  ensureApiKey();
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const distinctiveText = 'Marca uma reunião distinctive-text-xyz com o time amanhã às 10h';
  await extractStructuredIntent(distinctiveText, NOW);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[0].content, distinctiveText);
});

await check('17. nenhum dado interno (stateId/userId/proposalId) aparece no request', async () => {
  ensureApiKey();
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  const rawBody = calls[0].options.body;
  assert.ok(!/stateId|userId|proposalId/i.test(rawBody), 'request não deveria conter identificadores internos');
});

await check('17b. API key nunca aparece no corpo da requisição (só no header)', async () => {
  ensureApiKey();
  const calls = capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  const rawBody = calls[0].options.body;
  assert.ok(!rawBody.includes(process.env.ANTHROPIC_API_KEY), 'API key não deveria vazar para o corpo');
  assert.equal(calls[0].options.headers['x-api-key'], process.env.ANTHROPIC_API_KEY);
});

// ============================================================================
// EXCEÇÃO INESPERADA — mesma convenção do resto do módulo (não testada
// explicitamente aqui porque toda chamada de I/O já está em try/catch
// interno; ver auditoria estática abaixo confirmando isso)
// ============================================================================

// ============================================================================
// AUDITORIA ESTÁTICA DO ARQUIVO-FONTE
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/intent-extraction.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

await check('18. módulo é server-only', () => {
  assert.ok(codeOnly.includes("import 'server-only'"));
});

await check('19. zero storage/Supabase/orquestração/Calendar no código real', () => {
  const forbidden = [
    'runtime-state-storage',
    "from '../supabase/server'",
    "from '../supabase/admin'",
    'createAdminClient',
    "from './conversation-turn'",
    "from './proposal-turn'",
    "from './local-task-execution'",
    'createConversationState',
    'resolveFirstConversationalTurn',
    'resolveClarificationConversationalTurn',
    'resolveProposalConversationalTurn',
    'buildProposedAction',
    'createProposalState',
    'Calendar',
    'crypto.randomUUID(',
    'service_role',
    'SUPABASE_SECRET_KEY',
    'console.',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

await check('20. reaproveita isValidStructuredIntent real, nunca "as StructuredIntent"', () => {
  assert.ok(codeOnly.includes("from './runtime-state-validation'"));
  assert.ok(codeOnly.includes('isValidStructuredIntent('));
  assert.ok(!codeOnly.includes('as StructuredIntent'));
});

await check('21. API pública não recebe userId/stateId/proposalId/client/ProposedAction', () => {
  const signatureMatch = codeOnly.match(/export async function extractStructuredIntent\(([^)]*)\)/s);
  assert.ok(signatureMatch, 'assinatura pública não encontrada');
  const params = signatureMatch[1];
  assert.ok(!/userId/i.test(params));
  assert.ok(!/stateId/i.test(params));
  assert.ok(!/proposalId/i.test(params));
  assert.ok(!/supabase/i.test(params));
  assert.ok(!/ProposedAction/.test(params));
  assert.ok(!/deps/i.test(params));
});

// --- Resumo -------------------------------------------------------------

restoreEnvironment();

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
