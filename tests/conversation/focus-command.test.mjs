import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFocusCommand } from '../../src/lib/conversation/focus-command.ts';
import { parseScheduleExistingTaskCommand } from '../../src/lib/conversation/schedule-existing-task-command.ts';

assert.deepEqual(
  parseFocusCommand('Começar foco de 25 minutos em Revisar proposta'),
  { referenceRaw: 'Revisar proposta', minutes: 25 },
);

assert.deepEqual(
  parseFocusCommand('Inicie foco de 50 min na tarefa Preparar reunião.'),
  { referenceRaw: 'Preparar reunião', minutes: 50 },
);

assert.deepEqual(
  parseFocusCommand('Foco 25 minutos no Relatório mensal'),
  { referenceRaw: 'Relatório mensal', minutes: 25 },
);

assert.equal(parseFocusCommand('Começar foco de 30 minutos em Revisar proposta'), null);
assert.equal(parseFocusCommand('Começar foco de 25 minutos nisso'), null);
assert.equal(parseFocusCommand('Começar foco em Revisar proposta'), null);

const focusCommand = readFileSync(new URL('../../src/lib/conversation/focus-command.ts', import.meta.url), 'utf8');
const focusTimer = readFileSync(new URL('../../src/app/hoje/FocusTimer.tsx', import.meta.url), 'utf8');
const checklist = readFileSync(new URL('../../src/app/hoje/TodayChecklist.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../src/app/conversa/ConversationPanel.tsx', import.meta.url), 'utf8');

assert.ok(focusCommand.includes(".eq('user_id', userId)"));
assert.ok(focusCommand.includes(".eq('status', 'pending')"));
assert.ok(focusCommand.includes(".eq('needs_confirmation', false)"));
assert.ok(focusCommand.includes(".gte('deadline_at', start.utc.toISOString())"));
assert.ok(focusCommand.includes(".lt('deadline_at', end.utc.toISOString())"));
assert.ok(focusCommand.includes('matchEventReference'));
assert.ok(!focusCommand.includes('service_role'));
assert.ok(!focusCommand.includes('createAdminClient'));

assert.ok(focusTimer.includes('autoStartMinutes?: 25 | 50 | null'));
assert.ok(focusTimer.includes('Date.now() + autoStartMinutes * 60_000'));
assert.ok(!focusTimer.includes('localStorage'));
assert.ok(!focusTimer.includes('sessionStorage'));
assert.ok(!focusTimer.includes('supabase'));
assert.ok(!focusTimer.includes('Google'));

assert.ok(checklist.includes("params.get('focusTask')"));
assert.ok(checklist.includes("params.get('focusMinutes')"));
assert.ok(checklist.includes('focusRequest?.taskId === item.id'));
assert.ok(checklist.includes('autoStartMinutes={autoStartMinutes}'));
assert.ok(checklist.includes("window.history.replaceState(null, '', '/hoje')"));

assert.ok(panel.includes("result.status === 'focus_ready'"));
assert.ok(panel.includes('encodeURIComponent(result.taskId)'));
assert.ok(panel.includes('/hoje?focusTask=${taskId}&focusMinutes=${result.minutes}'));

assert.deepEqual(
  parseScheduleExistingTaskCommand('Agende ligar para o contador às 15 horas'),
  { referenceRaw: 'ligar para o contador', day: 'today', hour: 15, minute: 0 },
);
assert.deepEqual(
  parseScheduleExistingTaskCommand('Marque a tarefa Revisar proposta hoje às 14:30.'),
  { referenceRaw: 'Revisar proposta', day: 'today', hour: 14, minute: 30 },
);
assert.deepEqual(
  parseScheduleExistingTaskCommand('Agendar Preparar reunião as 9h15'),
  { referenceRaw: 'Preparar reunião', day: 'today', hour: 9, minute: 15 },
);
assert.deepEqual(
  parseScheduleExistingTaskCommand('Agende revisar proposta amanhã às 15 horas'),
  { referenceRaw: 'revisar proposta', day: 'tomorrow', hour: 15, minute: 0 },
);
assert.equal(parseScheduleExistingTaskCommand('Agende isso às 15 horas'), null);
assert.equal(parseScheduleExistingTaskCommand('Agende revisar proposta às 25 horas'), null);

const scheduleCommand = readFileSync(new URL('../../src/lib/conversation/schedule-existing-task-command.ts', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../../src/lib/conversation/conversation-entry.ts', import.meta.url), 'utf8');
assert.ok(scheduleCommand.includes(".eq('user_id', userId)"));
assert.ok(scheduleCommand.includes(".eq('status', 'pending')"));
assert.ok(scheduleCommand.includes(".eq('needs_confirmation', false)"));
assert.ok(scheduleCommand.includes(".gte('deadline_at', start.utc.toISOString())"));
assert.ok(scheduleCommand.includes(".lt('deadline_at', end.utc.toISOString())"));
assert.ok(scheduleCommand.includes('matchEventReference'));
assert.ok(scheduleCommand.includes("intentType: 'create_event'"));
assert.ok(scheduleCommand.includes("'today' | 'tomorrow'"));
assert.ok(!scheduleCommand.includes('service_role'));
assert.ok(!scheduleCommand.includes('createAdminClient'));
assert.ok(entry.includes('parseScheduleExistingTaskCommand(text) !== null'));
assert.ok(entry.includes('resolveScheduleExistingTaskCommand(command, timezone, now)'));
assert.ok(entry.includes('applyCreateEventDefaults(resolved.intent)'));

console.log('[PASS] foco por conversa aceita somente 25 ou 50 minutos com tarefa explícita');
console.log('[PASS] resolução usa somente tarefas de hoje, pendentes, confirmadas e do próprio usuário');
console.log('[PASS] cronômetro continua local e sem persistência desnecessária');
console.log('[PASS] agendamento natural converte uma tarefa explícita de hoje em proposta segura e aceita mover para amanhã');
