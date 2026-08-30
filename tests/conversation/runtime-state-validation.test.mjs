// Testes diretos de src/lib/conversation/runtime-state-validation.ts —
// especificamente do export público `isValidStructuredIntent`.
//
// Execução: npm run test:runtime-state-validation
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão de
// tests/conversation/confirmation.test.mjs. Nenhum loader/redirect
// necessário: este módulo é 100% puro (só `import type`, nenhum import de
// valor problemático), exatamente como confirmation.ts — mesmo comando
// simples (`node --experimental-strip-types`, sem `--conditions=react-server`).
//
// Escopo desta suíte: não é uma reauditoria exaustiva das 11 variantes de
// StructuredIntent (a lógica em si não mudou nesta subfase, e já é
// exercitada indiretamente sempre que uma ConversationState real
// atravessa runtime-state-storage.ts/conversation-turn.test.mjs). O
// objetivo aqui é demonstrar que o SÍMBOLO EXPORTADO funciona como
// fronteira pública — por isso a cobertura foca em `create_task` (a única
// variante hoje consumida pelo resto do pipeline, via buildProposedAction)
// e nos casos estruturais mínimos exigidos (não-objeto, intentType
// desconhecido, chave extra, campo aninhado inválido), mais UMA segunda
// variante (`capture_thought`) só para confirmar que o dispatch por
// `intentType` continua funcionando através do export, sem elaborar uma
// matriz completa das 11.

import assert from 'node:assert/strict';
import { isValidStructuredIntent } from '../../src/lib/conversation/runtime-state-validation.ts';

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

// --- Fixtures reais (nenhum dado pessoal) -----------------------------

function validCreateTaskFull() {
  return {
    missingFields: [],
    confidence: 0.9,
    intentType: 'create_task',
    task: { kind: 'new_task', title: 'Revisar orçamento', description: null },
    temporalWindow: null,
    duration: { source: 'stated', value: { minutes: 30 }, confidence: 0.9 },
    deadline: { source: 'stated', value: { at: '2026-09-01T10:00:00.000Z' }, confidence: 0.9 },
  };
}

function validCreateTaskMinimal() {
  return {
    missingFields: [],
    confidence: 0.5,
    intentType: 'create_task',
    task: { kind: 'new_task', title: 'Ligar para o cliente', description: null },
    temporalWindow: null,
    duration: null,
    deadline: null,
  };
}

function validCaptureThought() {
  return {
    missingFields: [],
    confidence: 0.4,
    intentType: 'capture_thought',
    task: null,
  };
}

// ============================================================================
// 1-2. create_task VÁLIDO -> true
// ============================================================================

check('1. create_task válido completo (deadline/duration "stated") -> true', () => {
  assert.equal(isValidStructuredIntent(validCreateTaskFull()), true);
});

check('2. create_task válido mínimo (temporalWindow/duration/deadline null) -> true', () => {
  assert.equal(isValidStructuredIntent(validCreateTaskMinimal()), true);
});

// ============================================================================
// 3. VALOR NÃO-OBJETO -> false
// ============================================================================

check('3a. string -> false', () => {
  assert.equal(isValidStructuredIntent('sim'), false);
});

check('3b. number -> false', () => {
  assert.equal(isValidStructuredIntent(42), false);
});

check('3c. null -> false', () => {
  assert.equal(isValidStructuredIntent(null), false);
});

check('3d. array -> false', () => {
  assert.equal(isValidStructuredIntent([]), false);
});

check('3e. undefined -> false', () => {
  assert.equal(isValidStructuredIntent(undefined), false);
});

// ============================================================================
// 4. intentType DESCONHECIDO -> false
// ============================================================================

check('4. intentType inventado -> false', () => {
  const bogus = { ...validCreateTaskMinimal(), intentType: 'send_rocket_to_moon' };
  assert.equal(isValidStructuredIntent(bogus), false);
});

// ============================================================================
// 5. create_task ESTRUTURALMENTE INVÁLIDO -> false
// ============================================================================

check('5a. create_task com chave extra (viola hasExactKeys) -> false', () => {
  const withExtra = { ...validCreateTaskMinimal(), unexpectedField: 'x' };
  assert.equal(isValidStructuredIntent(withExtra), false);
});

check('5b. create_task com task.kind inválido -> false', () => {
  const invalidTask = validCreateTaskMinimal();
  invalidTask.task = { ...invalidTask.task, kind: 'not_new_task' };
  assert.equal(isValidStructuredIntent(invalidTask), false);
});

check('5c. create_task com duration.source "unresolved" mas sem confidence -> false', () => {
  const invalid = validCreateTaskMinimal();
  invalid.duration = { source: 'unresolved' }; // falta `confidence`, exigido mesmo em unresolved
  assert.equal(isValidStructuredIntent(invalid), false);
});

check('5d. create_task com deadline.at não parseável como data -> false', () => {
  const invalid = validCreateTaskMinimal();
  invalid.deadline = { source: 'stated', value: { at: 'não é uma data' }, confidence: 0.9 };
  assert.equal(isValidStructuredIntent(invalid), false);
});

check('5e. create_task sem missingFields -> false', () => {
  const invalid = validCreateTaskMinimal();
  delete invalid.missingFields;
  assert.equal(isValidStructuredIntent(invalid), false);
});

// ============================================================================
// 6. SEGUNDA VARIANTE — confirma que o dispatch por intentType funciona
//    através do export (sem elaborar as 11)
// ============================================================================

check('6. capture_thought válido (task: null) -> true', () => {
  assert.equal(isValidStructuredIntent(validCaptureThought()), true);
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
