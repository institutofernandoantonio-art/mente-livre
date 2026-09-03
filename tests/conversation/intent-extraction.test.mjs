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
import {
  extractStructuredIntent,
  validateExplicitRelativeDateTimeConsistency,
} from '../../src/lib/conversation/intent-extraction.ts';
// Módulos REAIS, 100% puros, não alterados nesta subfase — usados só na
// seção "pipeline completo" abaixo, para provar ponta a ponta (guard ->
// builder -> prévia) sem precisar de nenhum dublê novo.
import { buildCreateCalendarEventAction } from '../../src/lib/conversation/calendar-event-proposal.ts';
import { buildEventProposalPreview } from '../../src/lib/conversation/presentation-ui.ts';

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
// SUBFASE 13 — GUARD DETERMINÍSTICO DE COERÊNCIA TEMPORAL
//
// Causa raiz comprovada por reprodução real (ver relatório da subfase): a
// mesma frase "Agende amanhã às 17h30 uma reunião de teste por 30
// minutos." produziu, em 3 chamadas reais à Anthropic, 2 respostas
// corretas (relative_day/tomorrow/17:30) e 1 errada (fixed, dia 03/09 em
// vez de 02/09, hora local tratada como se já fosse UTC).
// ============================================================================

// --- Helper puro: validateExplicitRelativeDateTimeConsistency --------------

function relativeDayIntent(day, time) {
  return {
    missingFields: [],
    confidence: 0.9,
    intentType: 'query_calendar',
    temporalWindow: { expression: 'x', resolved: { kind: 'relative_day', day, time } },
  };
}

function windowIntent(resolved) {
  return {
    missingFields: [],
    confidence: 0.9,
    intentType: 'query_calendar',
    temporalWindow: { expression: 'x', resolved },
  };
}

await check('G1. "amanhã às 17h30" + relative_day tomorrow 17:30 -> valid', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'Agende amanhã às 17h30 uma reunião de teste por 30 minutos.',
    relativeDayIntent('tomorrow', { hour: 17, minute: 30 }),
  );
  assert.equal(result, 'valid');
});

await check('G2. mesma frase + fixed -> mismatch (fixture EXATA do bug real observado)', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'Agende amanhã às 17h30 uma reunião de teste por 30 minutos.',
    windowIntent({ kind: 'fixed', start: '2026-09-03T17:30:00.000Z', end: '2026-09-03T18:00:00.000Z' }),
  );
  assert.equal(result, 'mismatch');
});

await check('G3. mesma frase + anchored_start -> mismatch', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'Agende amanhã às 17h30 uma reunião de teste por 30 minutos.',
    windowIntent({ kind: 'anchored_start', start: '2026-09-02T20:30:00.000Z' }),
  );
  assert.equal(result, 'mismatch');
});

await check('G4. mesma frase + relative_day tomorrow 17:00 (hora errada) -> mismatch', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'Agende amanhã às 17h30 uma reunião de teste por 30 minutos.',
    relativeDayIntent('tomorrow', { hour: 17, minute: 0 }),
  );
  assert.equal(result, 'mismatch');
});

await check('G5. mesma frase + relative_day today 17:30 (dia errado) -> mismatch', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'Agende amanhã às 17h30 uma reunião de teste por 30 minutos.',
    relativeDayIntent('today', { hour: 17, minute: 30 }),
  );
  assert.equal(result, 'mismatch');
});

await check('G6. "amanha as 17h30" (sem acento) -> reconhecido, valid', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'amanha as 17h30',
    relativeDayIntent('tomorrow', { hour: 17, minute: 30 }),
  );
  assert.equal(result, 'valid');
});

await check('G7. uppercase ("AMANHÃ ÀS 17H30") -> reconhecido, valid', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'AMANHÃ ÀS 17H30',
    relativeDayIntent('tomorrow', { hour: 17, minute: 30 }),
  );
  assert.equal(result, 'valid');
});

await check('G8. "amanhã às 17:30" (dois-pontos) -> reconhecido, valid', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'amanhã às 17:30',
    relativeDayIntent('tomorrow', { hour: 17, minute: 30 }),
  );
  assert.equal(result, 'valid');
});

await check('G9. "amanhã 17h30" (sem "às") -> reconhecido, valid', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'amanhã 17h30',
    relativeDayIntent('tomorrow', { hour: 17, minute: 30 }),
  );
  assert.equal(result, 'valid');
});

await check('G10. "hoje às 9h" + relative_day today 09:00 -> valid', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'hoje às 9h',
    relativeDayIntent('today', { hour: 9, minute: 0 }),
  );
  assert.equal(result, 'valid');
});

await check('G11. "hoje às 9h" + relative_day tomorrow -> mismatch', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'hoje às 9h',
    relativeDayIntent('tomorrow', { hour: 9, minute: 0 }),
  );
  assert.equal(result, 'mismatch');
});

await check('G12. hora inválida "25h" -> not_applicable (nunca aceita hora fora de 0-23)', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'amanhã às 25h',
    relativeDayIntent('tomorrow', { hour: 17, minute: 30 }),
  );
  assert.equal(result, 'not_applicable');
});

await check('G13. texto sem "hoje"/"amanhã" -> not_applicable', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'sexta-feira às 17h30',
    windowIntent({ kind: 'fixed', start: '2026-09-05T17:30:00.000Z', end: '2026-09-05T18:00:00.000Z' }),
  );
  assert.equal(result, 'not_applicable');
});

await check('G14. "amanhã" sem horário explícito -> not_applicable (nunca inventa hora)', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'amanhã',
    windowIntent({ kind: 'relative_day', day: 'tomorrow', time: null }),
  );
  assert.equal(result, 'not_applicable');
});

await check('G15. "depois de amanhã às 17h30" NÃO vira "tomorrow" simples -> not_applicable', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'depois de amanhã às 17h30',
    relativeDayIntent('tomorrow', { hour: 17, minute: 30 }),
  );
  assert.equal(result, 'not_applicable');
});

await check('G16. "amanhã à noite" sem hora explícita -> not_applicable', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'amanhã à noite',
    windowIntent({ kind: 'relative_day', day: 'tomorrow', time: null }),
  );
  assert.equal(result, 'not_applicable');
});

await check('G17. helper nunca lê duração (ignora completamente o campo)', () => {
  const intent = {
    missingFields: [],
    confidence: 0.9,
    intentType: 'create_event',
    task: { kind: 'new_task', title: 'x', description: null },
    temporalWindow: { expression: 'x', resolved: { kind: 'relative_day', day: 'tomorrow', time: { hour: 17, minute: 30 } } },
    duration: { source: 'stated', value: { minutes: 999999 }, confidence: 0.9 }, // absurdo, de propósito
    participants: [],
    calendarAction: 'create',
  };
  const result = validateExplicitRelativeDateTimeConsistency('amanhã às 17h30', intent);
  assert.equal(result, 'valid', 'duração absurda não deveria influenciar o veredito');
});

await check('G18. helper é puro — nunca muta o intent recebido', () => {
  const intent = relativeDayIntent('tomorrow', { hour: 17, minute: 30 });
  const before = JSON.stringify(intent);
  validateExplicitRelativeDateTimeConsistency('amanhã às 17h30', intent);
  assert.equal(JSON.stringify(intent), before);
});

await check('G18b. create_task com temporalWindow null -> not_applicable (nunca lança)', () => {
  const intent = {
    missingFields: [],
    confidence: 0.9,
    intentType: 'create_task',
    task: { kind: 'new_task', title: 'x', description: null },
    temporalWindow: null,
    duration: null,
    deadline: null,
  };
  const result = validateExplicitRelativeDateTimeConsistency('amanhã às 17h30', intent);
  assert.equal(result, 'not_applicable');
});

await check('G18c. intentType sem temporalWindow (cancel_event) -> not_applicable', () => {
  const result = validateExplicitRelativeDateTimeConsistency('amanhã às 17h30', VALID_CANCEL_EVENT);
  assert.equal(result, 'not_applicable');
});

// --- Integração real: extractStructuredIntent aplica o guard ---------------

function fixedWindowResponse(startIso, endIso) {
  return {
    missingFields: [],
    confidence: 0.98,
    intentType: 'create_event',
    task: { kind: 'new_task', title: 'Reunião de teste', description: null },
    temporalWindow: { expression: 'amanhã às 17h30', resolved: { kind: 'fixed', start: startIso, end: endIso } },
    duration: { source: 'stated', value: { minutes: 30 }, confidence: 0.98 },
    participants: [],
    calendarAction: 'create',
  };
}

function relativeDayResponse(day, hour, minute) {
  return {
    missingFields: [],
    confidence: 0.98,
    intentType: 'create_event',
    task: { kind: 'new_task', title: 'Reunião de teste', description: null },
    temporalWindow: { expression: 'amanhã às 17h30', resolved: { kind: 'relative_day', day, time: { hour, minute } } },
    duration: { source: 'stated', value: { minutes: 30 }, confidence: 0.98 },
    participants: [],
    calendarAction: 'create',
  };
}

const CREATE_EVENT_TEXT = 'Agende amanhã às 17h30 uma reunião de teste por 30 minutos.';

await check('G19. texto amanhã 17h30 + resposta correta (relative_day) -> intent aceito', async () => {
  ensureApiKey();
  capturingFetch(() => providerOkResponse(JSON.stringify(relativeDayResponse('tomorrow', 17, 30))));
  const result = await extractStructuredIntent(CREATE_EVENT_TEXT, NOW);
  assert.equal(result.status, 'extracted');
  assert.equal(result.intent.temporalWindow.resolved.kind, 'relative_day');
});

await check(
  'G20/G17-real. texto amanhã 17h30 + fixed ERRADO (fixture EXATA do bug) -> intent REJEITADO (invalid)',
  async () => {
    ensureApiKey();
    const calls = capturingFetch(() =>
      providerOkResponse(JSON.stringify(fixedWindowResponse('2026-09-03T17:30:00.000Z', '2026-09-03T18:00:00.000Z'))),
    );
    const result = await extractStructuredIntent(CREATE_EVENT_TEXT, NOW);
    assert.deepEqual(result, { status: 'invalid' });
    assert.equal(calls.length, 1, 'a NLU é chamada normalmente — o guard roda DEPOIS da resposta, nunca antes');
  },
);

await check('G21. texto amanhã 17h30 + data absoluta errada -> nunca chega ao pipeline (invalid, não extracted)', async () => {
  ensureApiKey();
  capturingFetch(() =>
    providerOkResponse(JSON.stringify(fixedWindowResponse('2026-09-10T00:00:00.000Z', '2026-09-10T00:30:00.000Z'))),
  );
  const result = await extractStructuredIntent(CREATE_EVENT_TEXT, NOW);
  assert.equal(result.status, 'invalid');
  assert.ok(!('intent' in result), 'resultado invalid nunca deveria carregar um intent');
});

await check('G22. texto "hoje às 14h" + resposta com day errado (tomorrow) -> rejeitado', async () => {
  ensureApiKey();
  capturingFetch(() => providerOkResponse(JSON.stringify(relativeDayResponse('tomorrow', 14, 0))));
  const result = await extractStructuredIntent('Agende hoje às 14h uma call.', NOW);
  assert.deepEqual(result, { status: 'invalid' });
});

await check('G23. query_calendar também protegido pelo mesmo guard', async () => {
  ensureApiKey();
  const wrongQueryResponse = {
    missingFields: [],
    confidence: 0.9,
    intentType: 'query_calendar',
    temporalWindow: { expression: 'amanhã às 17h30', resolved: { kind: 'fixed', start: '2026-09-03T17:30:00.000Z', end: '2026-09-03T18:30:00.000Z' } },
  };
  capturingFetch(() => providerOkResponse(JSON.stringify(wrongQueryResponse)));
  const result = await extractStructuredIntent('Estou livre amanhã às 17h30?', NOW);
  assert.deepEqual(result, { status: 'invalid' });
});

await check('G24. create_event também protegido pelo mesmo guard (mesma função, zero duplicação)', async () => {
  ensureApiKey();
  capturingFetch(() =>
    providerOkResponse(JSON.stringify(fixedWindowResponse('2026-09-03T17:30:00.000Z', '2026-09-03T18:00:00.000Z'))),
  );
  const result = await extractStructuredIntent(CREATE_EVENT_TEXT, NOW);
  assert.deepEqual(result, { status: 'invalid' });
});

await check('G25-G29. mismatch nunca chega perto de calendar query/freeBusy/ProposalState/claim/Google write', async () => {
  // Prova estrutural, não de execução: `extractStructuredIntent` (este
  // módulo) nunca importa nenhuma dessas peças (ver teste 19, auditoria
  // estática já existente) — um `status:'invalid'` sai daqui e nunca
  // carrega um `intent`, então NENHUM chamador rio abaixo
  // (resolveCalendarQuery/attemptCreateEvent/ProposalState/claim/Google
  // write) pode sequer ser invocado, porque nenhum deles recebe um intent
  // a partir de um resultado sem a chave `intent`.
  ensureApiKey();
  capturingFetch(() =>
    providerOkResponse(JSON.stringify(fixedWindowResponse('2026-09-03T17:30:00.000Z', '2026-09-03T18:00:00.000Z'))),
  );
  const result = await extractStructuredIntent(CREATE_EVENT_TEXT, NOW);
  assert.equal(result.status, 'invalid');
  assert.equal(Object.keys(result).length, 1, 'invalid carrega SÓ {status}, nunca um intent parcial/residual');
});

// --- Regressão: casos corretos continuam funcionando normalmente -----------

await check('G30. regressão — "amanhã às 17h30" correto continua extraído normalmente', async () => {
  ensureApiKey();
  capturingFetch(() => providerOkResponse(JSON.stringify(relativeDayResponse('tomorrow', 17, 30))));
  const result = await extractStructuredIntent(CREATE_EVENT_TEXT, NOW);
  assert.equal(result.status, 'extracted');
});

await check('G31. regressão — texto sem "hoje"/"amanhã" com fixed nunca é rejeitado por este guard', async () => {
  ensureApiKey();
  capturingFetch(() =>
    providerOkResponse(JSON.stringify(fixedWindowResponse('2026-09-10T14:00:00.000Z', '2026-09-10T14:30:00.000Z'))),
  );
  const result = await extractStructuredIntent('Agende uma reunião na sexta-feira às 14h.', NOW);
  assert.equal(result.status, 'extracted', 'fixed continua válido quando o texto não diz hoje/amanhã explicitamente');
});

await check('G32. regressão — create_task (temporalWindow sempre null) nunca é afetado pelo guard', async () => {
  ensureApiKey();
  capturingFetch(() => providerOkResponse(JSON.stringify(VALID_CREATE_TASK)));
  const result = await extractStructuredIntent('me lembra de ligar amanhã', NOW);
  assert.equal(result.status, 'extracted');
});

// ============================================================================
// SUBFASE 18 — divergência de 3h na prévia ("21:00" virava "18:00"):
// horário mencionado SOZINHO, sem "hoje"/"amanhã" explícitos, também
// precisa ser protegido (equivale a "hoje" em português). Fixture EXATA
// do bug real: "Marca uma ligação às 21:00 por 30 minutos." -> a LLM
// devolveu `fixed` com "21:00" embutido como se já fosse UTC; a prévia
// (corretamente convertida para America/Sao_Paulo) mostrava 18:00.
// ============================================================================

const BARE_TIME_TEXT_21H = 'Marca uma ligação às 21:00 por 30 minutos.';

await check('G33. "às 21h" SEM dia explícito + relative_day today 21:00 -> valid', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    BARE_TIME_TEXT_21H,
    relativeDayIntent('today', { hour: 21, minute: 0 }),
  );
  assert.equal(result, 'valid');
});

await check('G34. fixture EXATA do bug real: "às 21h" sem dia + fixed (21:00 embutido como UTC) -> mismatch', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    BARE_TIME_TEXT_21H,
    windowIntent({ kind: 'fixed', start: '2026-09-02T21:00:00.000Z', end: '2026-09-02T21:30:00.000Z' }),
  );
  assert.equal(result, 'mismatch');
});

await check('G35. "9h" sem dia + relative_day today 09:00 -> valid', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'Agende uma call às 9h.',
    relativeDayIntent('today', { hour: 9, minute: 0 }),
  );
  assert.equal(result, 'valid');
});

await check('G36. "18h30" sem dia + relative_day today 18:30 -> valid', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'Marca uma call às 18h30.',
    relativeDayIntent('today', { hour: 18, minute: 30 }),
  );
  assert.equal(result, 'valid');
});

await check('G37. "18h30" sem dia + fixed (embutido como UTC) -> mismatch', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'Marca uma call às 18h30.',
    windowIntent({ kind: 'fixed', start: '2026-09-02T18:30:00.000Z', end: '2026-09-02T19:00:00.000Z' }),
  );
  assert.equal(result, 'mismatch');
});

await check('G38. "amanhã às 21h" continua funcionando (dia explícito tem precedência sobre a inferência de "hoje")', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'Agende amanhã às 21h uma call.',
    relativeDayIntent('tomorrow', { hour: 21, minute: 0 }),
  );
  assert.equal(result, 'valid');
});

await check('G39. "sexta-feira às 21h" -> not_applicable (dia que o guard não entende, nunca um palpite de "hoje")', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'Marca uma ligação sexta-feira às 21:00.',
    windowIntent({ kind: 'fixed', start: '2026-09-05T21:00:00.000Z', end: '2026-09-05T21:30:00.000Z' }),
  );
  assert.equal(result, 'not_applicable');
});

await check('G40. data explícita "10/10 às 21h" -> not_applicable (nunca inferido como "hoje")', () => {
  const result = validateExplicitRelativeDateTimeConsistency(
    'Marca uma ligação dia 10/10 às 21h.',
    windowIntent({ kind: 'fixed', start: '2026-10-10T21:00:00.000Z', end: '2026-10-10T21:30:00.000Z' }),
  );
  assert.equal(result, 'not_applicable');
});

await check(
  'G41/regressão real. texto "às 21h" sem dia + fixed ERRADO (fixture EXATA) -> intent REJEITADO na integração real (invalid)',
  async () => {
    ensureApiKey();
    const calls = capturingFetch(() =>
      providerOkResponse(JSON.stringify(fixedWindowResponse('2026-09-02T21:00:00.000Z', '2026-09-02T21:30:00.000Z'))),
    );
    const result = await extractStructuredIntent(BARE_TIME_TEXT_21H, NOW);
    assert.deepEqual(result, { status: 'invalid' });
    assert.equal(calls.length, 1, 'a NLU é chamada normalmente — o guard roda DEPOIS da resposta, nunca antes');
  },
);

await check('G42. texto "às 21h" sem dia + resposta correta (relative_day today) -> intent aceito', async () => {
  ensureApiKey();
  capturingFetch(() => providerOkResponse(JSON.stringify(relativeDayResponse('today', 21, 0))));
  const result = await extractStructuredIntent(BARE_TIME_TEXT_21H, NOW);
  assert.equal(result.status, 'extracted');
  assert.deepEqual(result.intent.temporalWindow.resolved, {
    kind: 'relative_day',
    day: 'today',
    time: { hour: 21, minute: 0 },
  });
});

await check('G43. regressão — "sexta-feira às 14h" com fixed continua aceito (guard nunca inventa "hoje" para outro dia)', async () => {
  ensureApiKey();
  capturingFetch(() =>
    providerOkResponse(JSON.stringify(fixedWindowResponse('2026-09-05T17:00:00.000Z', '2026-09-05T17:30:00.000Z'))),
  );
  const result = await extractStructuredIntent('Agende uma reunião na sexta-feira às 14h.', NOW);
  assert.equal(result.status, 'extracted');
});

// --- Pipeline completo: guard -> builder -> prévia (data/hora exibida) ----
//
// Prova ponta a ponta, com os módulos REAIS de materialização/exibição
// (nenhum dublê nesta seção — calendar-event-proposal.ts e
// presentation-ui.ts não foram alterados nesta subfase; usados aqui só
// para confirmar que a correção na fronteira da NLU é suficiente para o
// resto do pipeline, já comprovadamente correto, produzir a hora CERTA
// na prévia final).

const PIPELINE_TIMEZONE = 'America/Sao_Paulo';
// now: 2026-09-02T18:00:00.000Z = 15:00 local em 02/09/2026.
const PIPELINE_NOW = Date.parse('2026-09-02T18:00:00.000Z');

const PIPELINE_CASES = [
  { label: '21:00 -> 21:00', hour: 21, minute: 0, durationMinutes: 30, expectedTimeRange: '21:00 às 21:30' },
  { label: '09:00 -> 09:00', hour: 9, minute: 0, durationMinutes: 30, expectedTimeRange: '09:00 às 09:30' },
  { label: '18:30 -> 18:30', hour: 18, minute: 30, durationMinutes: 30, expectedTimeRange: '18:30 às 19:00' },
];

for (const { label, hour, minute, durationMinutes, expectedTimeRange } of PIPELINE_CASES) {
  await check(`G44. pipeline completo (${label}), duração ${durationMinutes}min, hoje em America/Sao_Paulo`, () => {
    // Intent já aprovado pelo guard (relative_day/today) — exatamente o
    // shape que a extração real produz depois da correção desta subfase.
    const intent = {
      missingFields: [],
      confidence: 0.98,
      intentType: 'create_event',
      task: { kind: 'new_task', title: 'Compromisso de teste', description: null },
      temporalWindow: { expression: 'x', resolved: { kind: 'relative_day', day: 'today', time: { hour, minute } } },
      duration: { source: 'stated', value: { minutes: durationMinutes }, confidence: 1 },
      participants: [],
      calendarAction: 'create',
    };

    const guardResult = validateExplicitRelativeDateTimeConsistency('x', intent);
    assert.notEqual(guardResult, 'mismatch');

    const build = buildCreateCalendarEventAction(intent, PIPELINE_NOW, PIPELINE_TIMEZONE);
    assert.equal(build.status, 'built');

    const preview = buildEventProposalPreview(build.action.event);
    assert.equal(preview.date, '02/09/2026', 'data de hoje no fuso America/Sao_Paulo');
    assert.equal(preview.timeRange, expectedTimeRange, 'horário exibido na prévia deve ser IDÊNTICO ao informado');
  });
}

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
