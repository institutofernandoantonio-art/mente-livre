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
import {
  isValidStructuredIntent,
  validateStoredRuntimeState,
} from '../../src/lib/conversation/runtime-state-validation.ts';

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

// ============================================================================
// 7. ProposedAction via validateStoredRuntimeState — create_local_task
//    (regressão) + create_calendar_event (Subfase 1 do Calendar, novo)
//
// `validateStoredRuntimeState` é o único export público que efetivamente
// alcança `isValidProposedAction`/`isValidProposedCalendarEventEvent`
// (ambos privados) — por isso os testes abaixo passam por uma linha
// inteira de `conversation_runtime_states` (state_kind: 'proposal'), não
// por uma chamada direta a um símbolo interno.
// ============================================================================

const EXPIRES_AT_MS = Date.UTC(2026, 8, 1, 12, 30, 0);
const EXPIRES_AT_ISO = new Date(EXPIRES_AT_MS).toISOString();
const CREATED_AT_MS = Date.UTC(2026, 8, 1, 12, 0, 0);

function proposalRow(action) {
  return {
    state_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    state_kind: 'proposal',
    payload: {
      status: 'awaiting_confirmation',
      proposalId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      action,
      createdAt: CREATED_AT_MS,
      expiresAt: EXPIRES_AT_MS,
    },
    expires_at: EXPIRES_AT_ISO,
  };
}

const validLocalTaskAction = {
  actionType: 'create_local_task',
  task: { title: 'Revisar orçamento', description: null, deadline: null, duration: null },
};

function validCalendarEventAction(overrides = {}) {
  return {
    actionType: 'create_calendar_event',
    event: {
      title: 'Reunião com Ricardo',
      description: null,
      start: '2026-09-02T17:00:00.000Z',
      end: '2026-09-02T18:00:00.000Z',
      timezone: 'America/Sao_Paulo',
      reminderMinutesBeforeStart: 30,
      ...overrides,
    },
  };
}

check('7a. create_local_task continua válido através de validateStoredRuntimeState (regressão)', () => {
  const result = validateStoredRuntimeState(proposalRow(validLocalTaskAction));
  assert.equal(result.status, 'valid');
});

check('7b. create_calendar_event com shape correto -> valid', () => {
  const result = validateStoredRuntimeState(proposalRow(validCalendarEventAction()));
  assert.equal(result.status, 'valid');
  assert.equal(result.value.state.action.actionType, 'create_calendar_event');
});

check('7c. create_calendar_event com campo extra em event -> invalid', () => {
  const withExtra = validCalendarEventAction();
  withExtra.event.location = 'Sala 3';
  const result = validateStoredRuntimeState(proposalRow(withExtra));
  assert.equal(result.status, 'invalid');
});

check('7d. create_calendar_event com start não-ISO -> invalid', () => {
  const withBadStart = validCalendarEventAction({ start: 'não é uma data' });
  const result = validateStoredRuntimeState(proposalRow(withBadStart));
  assert.equal(result.status, 'invalid');
});

check('7e. create_calendar_event com end anterior ao start -> invalid', () => {
  const withBadEnd = validCalendarEventAction({
    start: '2026-09-02T18:00:00.000Z',
    end: '2026-09-02T17:00:00.000Z',
  });
  const result = validateStoredRuntimeState(proposalRow(withBadEnd));
  assert.equal(result.status, 'invalid');
});

check('7f. create_calendar_event com end igual ao start -> invalid (end deve ser estritamente maior)', () => {
  const withEqualEnd = validCalendarEventAction({
    start: '2026-09-02T17:00:00.000Z',
    end: '2026-09-02T17:00:00.000Z',
  });
  const result = validateStoredRuntimeState(proposalRow(withEqualEnd));
  assert.equal(result.status, 'invalid');
});

check('7g. create_calendar_event com reminderMinutesBeforeStart != 30 -> invalid', () => {
  const withBadReminder = validCalendarEventAction({ reminderMinutesBeforeStart: 15 });
  const result = validateStoredRuntimeState(proposalRow(withBadReminder));
  assert.equal(result.status, 'invalid');
});

check('7h. create_calendar_event com timezone inválido -> invalid', () => {
  const withBadTimezone = validCalendarEventAction({ timezone: 'Nao/Existe' });
  const result = validateStoredRuntimeState(proposalRow(withBadTimezone));
  assert.equal(result.status, 'invalid');
});

check('7i. actionType desconhecido (nem create_local_task nem create_calendar_event) -> invalid', () => {
  const bogus = { actionType: 'delete_everything', task: {} };
  const result = validateStoredRuntimeState(proposalRow(bogus));
  assert.equal(result.status, 'invalid');
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
