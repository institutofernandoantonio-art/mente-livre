import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTaskPriorityCommand } from '../../src/lib/conversation/task-priority-parser.ts';

const urgentImportant = parseTaskPriorityCommand('Marque a tarefa Ligar para Mota como urgente e importante.');
assert.deepEqual(urgentImportant, {
  referenceRaw: 'Ligar para Mota',
  priority: 'alta',
  bucket: 'fazer_hoje',
});

const important = parseTaskPriorityCommand('Revisar orçamento é importante mas não urgente');
assert.deepEqual(important, {
  referenceRaw: 'Revisar orçamento',
  priority: 'média',
  bucket: 'planejar',
});

const delegate = parseTaskPriorityCommand('Classifique Enviar proposta como delegar');
assert.deepEqual(delegate, {
  referenceRaw: 'Enviar proposta',
  priority: 'baixa',
  bucket: 'delegar',
});

const later = parseTaskPriorityCommand('Coloque Relatório mensal como depois');
assert.deepEqual(later, {
  referenceRaw: 'Relatório mensal',
  priority: null,
  bucket: 'depois',
});

assert.equal(parseTaskPriorityCommand('Agende reunião amanhã às 15 horas'), null);
assert.equal(parseTaskPriorityCommand('Planeje reunião amanhã'), null);
assert.equal(parseTaskPriorityCommand('isso é urgente e importante'), null);
assert.equal(parseTaskPriorityCommand('essa é fazer hoje'), null);
assert.equal(parseTaskPriorityCommand(''), null);

const executor = readFileSync(new URL('../../src/lib/conversation/task-priority-command.ts', import.meta.url), 'utf8');
assert.ok(executor.includes("import 'server-only'"));
assert.ok(executor.includes('getClaims()'));
assert.ok(executor.includes(".eq('user_id', userId)"));
assert.ok(executor.includes(".eq('status', 'pending')"));
assert.ok(executor.includes(".eq('needs_confirmation', false)"));
assert.ok(executor.includes('matchEventReference('));
assert.ok(executor.includes(".update({ priority: command.priority })"));
assert.ok(executor.includes("revalidatePath('/tarefas')"));
assert.ok(executor.includes("revalidatePath('/hoje')"));
assert.ok(!executor.includes('service_role'));
assert.ok(!executor.includes('createAdminClient'));
assert.ok(!executor.includes('console.'));
assert.ok(!executor.includes('candidates: matched'));

const entry = readFileSync(new URL('../../src/lib/conversation/conversation-entry.ts', import.meta.url), 'utf8');
assert.ok(entry.includes('parseTaskPriorityCommand(text)'));
assert.ok(entry.includes('applyTaskPriorityCommand(command)'));
assert.ok(entry.includes("status: 'task_priority_updated'"));
assert.ok(entry.includes('if (parseTaskPriorityCommand(text) !== null) return true;'));

const presentation = readFileSync(new URL('../../src/lib/conversation/presentation-ui.ts', import.meta.url), 'utf8');
assert.ok(presentation.includes('Prioridade atualizada: Fazer hoje.'));
assert.ok(presentation.includes('Prioridade atualizada: Planejar.'));
assert.ok(presentation.includes('Prioridade atualizada: Delegar.'));
assert.ok(presentation.includes('Prioridade atualizada: Depois.'));
assert.ok(presentation.includes('Encontrei mais de uma tarefa parecida.'));

console.log('[PASS] linguagem natural mapeia os quatro quadrantes sem depender do canal de entrada');
console.log('[PASS] referências vagas são recusadas em vez de adivinhadas');
console.log('[PASS] comandos de agenda/planejamento não são sequestrados pelo parser de prioridade');
console.log('[PASS] mutação mantém sessão, ownership, pending, confirmação e RLS como barreiras');
console.log('[PASS] nenhum id/candidato interno é exposto no resultado conversacional');
