// Testes das PROPRIEDADES matemáticas da transformação usada para derivar
// `google_event_id` a partir de `proposal_id` — Subfase 3 da criação de
// compromissos no Google Calendar.
//
// Execução: npm run test:calendar-event-id
//
// IMPORTANTE — o que este arquivo prova, e o que NÃO prova:
//
// A derivação REAL e AUTORITATIVA vive só em SQL, dentro de
// `private.claim_calendar_event_execution`
// (supabase/migrations/20260901100000_create_calendar_event_executions.sql):
// `lower(replace(p_proposal_id::text, '-', ''))`. Esta migration NÃO foi
// aplicada no Supabase remoto — não existe Postgres real disponível nesta
// subfase para executar essa expressão de verdade.
//
// O helper abaixo (`deriveGoogleEventIdForTest`) é uma cópia LOCAL, só
// para teste, da MESMA transformação de string (remover hífens, minúsculas)
// — nunca importado nem usado por nenhum código de produção (o wrapper
// TypeScript, calendar-event-claim.ts, nunca deriva o id sozinho; ele só
// valida o FORMATO do que a RPC devolve, ver
// tests/conversation/calendar-event-claim.test.mjs). Os testes aqui provam
// as propriedades ALGÉBRICAS da transformação (determinismo, distinção,
// charset, comprimento) — nunca que a expressão SQL real, executada num
// Postgres de verdade, se comporta assim. Essa segunda prova só é possível
// depois que a migration for aplicada e exercitada remotamente (fora do
// escopo desta subfase). A auditoria estática em
// tests/google/calendar-event-executions-migration.test.mjs confirma, por
// leitura do arquivo-fonte, que a migration usa EXATAMENTE esta mesma
// expressão (`lower(replace(..., '-', ''))`) — nunca uma diferente.

import assert from 'node:assert/strict';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

function check(name, fn) {
  try {
    fn();
    record(name, true);
  } catch (err) {
    record(name, false, err.message);
  }
}

// Espelha 1:1 `lower(replace(p_proposal_id::text, '-', ''))` — nunca usada
// fora deste arquivo de teste.
function deriveGoogleEventIdForTest(proposalId) {
  return proposalId.replace(/-/g, '').toLowerCase();
}

const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// Google Calendar events.insert aceita `id` num charset base32hex
// (`0-9`, `a-v`) — subconjunto explícito do que a transformação realmente
// produz (`[0-9a-f]`, um subconjunto AINDA MENOR: hex é {0-9,a-f} ⊂
// {0-9,a-v} = base32hex). Comprimento aceito pelo Google: 5 a 1024
// caracteres.
const GOOGLE_BASE32HEX_CHARSET = /^[0-9a-v]+$/;
const HEX_CHARSET = /^[0-9a-f]{32}$/;

check('1. UUID válido -> exatamente 32 caracteres, só [0-9a-f], minúsculas', () => {
  const id = deriveGoogleEventIdForTest(UUID_A);
  assert.equal(id.length, 32);
  assert.match(id, HEX_CHARSET);
  assert.equal(id, id.toLowerCase());
});

check('2. mesmo proposalId -> sempre o mesmo google_event_id (determinístico)', () => {
  assert.equal(deriveGoogleEventIdForTest(UUID_A), deriveGoogleEventIdForTest(UUID_A));
  assert.equal(deriveGoogleEventIdForTest(UUID_A), '123e4567e89b12d3a456426614174000');
});

check('3. UUIDs diferentes -> ids diferentes', () => {
  assert.notEqual(deriveGoogleEventIdForTest(UUID_A), deriveGoogleEventIdForTest(UUID_B));
});

check('4a. resultado satisfaz o charset base32hex aceito pelo Google (0-9, a-v) — [0-9a-f] é subconjunto estrito', () => {
  const id = deriveGoogleEventIdForTest(UUID_A);
  assert.match(id, GOOGLE_BASE32HEX_CHARSET);
});

check('4b. comprimento (32) está dentro do intervalo aceito pelo Google (5-1024)', () => {
  const id = deriveGoogleEventIdForTest(UUID_A);
  assert.ok(id.length >= 5 && id.length <= 1024);
});

check('4c. UUID em maiúsculas produz o MESMO id (lower() é efetivo, não redundante)', () => {
  assert.equal(deriveGoogleEventIdForTest(UUID_A.toUpperCase()), deriveGoogleEventIdForTest(UUID_A));
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
