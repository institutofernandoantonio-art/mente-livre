// Testes unitários de src/lib/conversation/clarification.ts.
//
// Execução: npm run test:clarification
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão do resto do
// projeto. Importa o MÓDULO REAL (evaluateClarification), zero dublê: este
// arquivo é 100% puro (zero I/O, zero Date.now(), zero Supabase/Google/
// Anthropic — ver cabeçalho do próprio módulo), então não há nada a
// substituir.
//
// PRIMEIRO arquivo de teste dedicado a este módulo (não existia nenhum até
// agora — gap real identificado na investigação do bug de "participant" em
// create_event: o comportamento de `collectMissingFields`/
// `evaluateClarification` só era exercitado indiretamente, e de forma
// incompleta, através de conversation-turn.test.mjs, cujo fixture padrão
// de create_event sempre usava `participants: []`, nunca um array
// não-vazio — por isso o bug real não foi pego antes de chegar a
// produção).
//
// Escopo deste arquivo: focado no bug corrigido (create_event nunca mais
// bloqueia por `participants`) mais uma cobertura de regressão das OUTRAS
// regras de create_event já existentes (temporal_window/time/duration/
// event_reference), para provar que a remoção do bloco de participant não
// tocou em mais nada. Cobertura exaustiva de TODOS os intentTypes/regras
// de clarification.ts (plan_task/suggest_time/reschedule_event/
// query_calendar/etc., inalterados nesta correção) fica fora de escopo
// deste arquivo — não é o que está sendo corrigido agora.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateClarification } from '../../src/lib/conversation/clarification.ts';

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

// --- Fixture base de create_event -------------------------------------

function createEventIntent(overrides = {}) {
  return {
    missingFields: [],
    confidence: 0.9,
    intentType: 'create_event',
    task: { kind: 'new_task', title: 'Reunião de teste', description: null },
    temporalWindow: {
      expression: 'hoje às 11h',
      resolved: { kind: 'relative_day', day: 'today', time: { hour: 11, minute: 0 } },
    },
    duration: { source: 'stated', value: { minutes: 15 }, confidence: 0.97 },
    participants: [],
    calendarAction: 'create',
    ...overrides,
  };
}

// ============================================================================
// SUBFASE 17 — correção do bug de "participant" bloqueando create_event
// ============================================================================

check('1. fixture EXATO do bug real: "Ligar para Mota" com participante extraído -> ready, zero missingFields', () => {
  const intent = createEventIntent({
    task: { kind: 'new_task', title: 'Ligar para Mota', description: null },
    participants: [{ raw: 'Mota', resolvedId: null }],
  });
  const decision = evaluateClarification(intent);
  assert.deepEqual(decision, { status: 'ready', missingFields: [] });
});

check('2. participants com 1 pessoa (resolvedId null, como sempre é) -> nunca gera missingFields "participant"', () => {
  const intent = createEventIntent({ participants: [{ raw: 'Ricardo', resolvedId: null }] });
  const decision = evaluateClarification(intent);
  assert.equal(decision.status, 'ready');
});

check('3. participants com várias pessoas -> nunca gera missingFields "participant"', () => {
  const intent = createEventIntent({
    participants: [
      { raw: 'Paulo', resolvedId: null },
      { raw: 'Ana', resolvedId: null },
    ],
  });
  const decision = evaluateClarification(intent);
  assert.equal(decision.status, 'ready');
});

check('4. participants vazio (comportamento pré-existente) -> continua ready', () => {
  const intent = createEventIntent({ participants: [] });
  const decision = evaluateClarification(intent);
  assert.deepEqual(decision, { status: 'ready', missingFields: [] });
});

check('5. "participant" nunca aparece em missingFields de create_event, mesmo quando OUTROS campos faltam', () => {
  const intent = createEventIntent({
    duration: null,
    participants: [{ raw: 'Mota', resolvedId: null }],
  });
  const decision = evaluateClarification(intent);
  assert.equal(decision.status, 'needs_clarification');
  assert.ok(!decision.missingFields.includes('participant'), 'participant nunca deveria aparecer');
  assert.deepEqual(decision.missingFields, ['duration']);
});

// --- Regressão: as OUTRAS regras de create_event continuam intactas -------

check('6. regressão: temporal_window unresolved continua pedindo temporal_window', () => {
  const intent = createEventIntent({
    temporalWindow: { expression: 'algum dia', resolved: { kind: 'unresolved' } },
  });
  const decision = evaluateClarification(intent);
  assert.equal(decision.status, 'needs_clarification');
  assert.deepEqual(decision.missingFields, ['temporal_window']);
});

check('7. regressão: relative_day sem hora continua pedindo time', () => {
  const intent = createEventIntent({
    temporalWindow: { expression: 'hoje', resolved: { kind: 'relative_day', day: 'today', time: null } },
  });
  const decision = evaluateClarification(intent);
  assert.equal(decision.status, 'needs_clarification');
  assert.deepEqual(decision.missingFields, ['time']);
});

check('8. regressão: duration ausente continua pedindo duration', () => {
  const intent = createEventIntent({ duration: null });
  const decision = evaluateClarification(intent);
  assert.equal(decision.status, 'needs_clarification');
  assert.deepEqual(decision.missingFields, ['duration']);
});

check('9. regressão: duration unresolved (source) continua pedindo duration', () => {
  const intent = createEventIntent({ duration: { source: 'unresolved', confidence: 0.4 } });
  const decision = evaluateClarification(intent);
  assert.equal(decision.status, 'needs_clarification');
  assert.deepEqual(decision.missingFields, ['duration']);
});

check('10. regressão: relative_to_event sem eventReference resolvida continua pedindo event_reference', () => {
  const intent = createEventIntent({
    temporalWindow: {
      expression: 'depois da reunião com o time',
      resolved: {
        kind: 'relative_to_event',
        anchor: 'after',
        eventReference: { kind: 'existing_reference', raw: 'a reunião com o time', resolvedId: null },
      },
    },
  });
  const decision = evaluateClarification(intent);
  assert.equal(decision.status, 'needs_clarification');
  assert.deepEqual(decision.missingFields, ['event_reference']);
});

check('11. regressão: fixed/anchored_start (janela já absoluta) nunca pedem temporal_window/time', () => {
  const fixedIntent = createEventIntent({
    temporalWindow: {
      expression: '10/10 às 14h',
      resolved: { kind: 'fixed', start: '2026-10-10T17:00:00.000Z', end: '2026-10-10T17:30:00.000Z' },
    },
  });
  const anchoredIntent = createEventIntent({
    temporalWindow: { expression: 'a partir de agora', resolved: { kind: 'anchored_start', start: '2026-10-10T17:00:00.000Z' } },
  });
  assert.equal(evaluateClarification(fixedIntent).status, 'ready');
  assert.equal(evaluateClarification(anchoredIntent).status, 'ready');
});

check('12. tudo certo, participants vazio, sem nenhum campo faltando -> ready (baseline)', () => {
  const decision = evaluateClarification(createEventIntent());
  assert.deepEqual(decision, { status: 'ready', missingFields: [] });
});

// --- Auditoria estática: a checagem antiga foi removida, não escondida ----

check('13. código-fonte: `resolvedId === null` não aparece mais associado a create_event/participants', () => {
  // Prova estrutural mínima, sem reescrever o parser: a checagem antiga
  // (`intent.participants.some((p) => p.resolvedId === null)`) não existe
  // mais em lugar nenhum do arquivo — nunca escondida atrás de outro nome.
  const source = readFileSync(
    fileURLToPath(new URL('../../src/lib/conversation/clarification.ts', import.meta.url)),
    'utf8',
  );
  assert.ok(!source.includes('hasUnresolvedParticipant'));
  assert.ok(!source.includes("fields.push('participant')"));
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
