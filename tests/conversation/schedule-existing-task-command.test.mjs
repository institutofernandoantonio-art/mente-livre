import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseScheduleExistingTaskCommand } from '../../src/lib/conversation/schedule-existing-task-command.ts';

assert.deepEqual(
  parseScheduleExistingTaskCommand('Agende ligar para o contador às 15 horas'),
  { referenceRaw: 'ligar para o contador', hour: 15, minute: 0 },
);

assert.deepEqual(
  parseScheduleExistingTaskCommand('Marque a tarefa Revisar proposta hoje às 14:30.'),
  { referenceRaw: 'Revisar proposta', hour: 14, minute: 30 },
);

assert.deepEqual(
  parseScheduleExistingTaskCommand('Agendar Preparar reunião as 9h15'),
  { referenceRaw: 'Preparar reunião', hour: 9, minute: 15 },
);

assert.equal(parseScheduleExistingTaskCommand('Agende isso às 15 horas'), null);
assert.equal(parseScheduleExistingTaskCommand('Agende revisar proposta amanhã às 15 horas'), null);
assert.equal(parseScheduleExistingTaskCommand('Agende revisar proposta às 25 horas'), null);
assert.equal(parseScheduleExistingTaskCommand('Ligar para o contador hoje'), null);

const source = readFileSync(new URL('../../src/lib/conversation/schedule-existing-task-command.ts', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../../src/lib/conversation/conversation-entry.ts', import.meta.url), 'utf8');

assert.ok(source.includes(".eq('user_id', userId)"));
assert.ok(source.includes(".eq('status', 'pending')"));
assert.ok(source.includes(".eq('needs_confirmation', false)"));
assert.ok(source.includes(".gte('deadline_at', start.utc.toISOString())"));
assert.ok(source.includes(".lt('deadline_at', end.utc.toISOString())"));
assert.ok(source.includes('matchEventReference'));
assert.ok(source.includes("intentType: 'create_event'"));
assert.ok(source.includes("day: 'today'"));
assert.ok(!source.includes('service_role'));
assert.ok(!source.includes('createAdminClient'));

assert.ok(entry.includes('parseScheduleExistingTaskCommand(text) !== null'));
assert.ok(entry.includes('resolveScheduleExistingTaskCommand(command, timezone, now)'));
assert.ok(entry.includes('applyCreateEventDefaults(resolved.intent)'));
assert.ok(entry.includes('resolveFirstConversationalTurn(intent, now, expirations, timezone)'));

console.log('[PASS] agendamento natural localiza somente tarefa explícita do checklist de hoje');
console.log('[PASS] horário é materializado como create_event e segue proposta/confirmação existente');
console.log('[PASS] referências vagas, amanhã e horários inválidos falham fechado');
