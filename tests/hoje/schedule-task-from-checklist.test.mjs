import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const checklist = readFileSync(new URL('../../src/app/hoje/TodayChecklist.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../src/app/conversa/page.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../src/app/conversa/ConversationPanel.tsx', import.meta.url), 'utf8');

assert.ok(checklist.includes('Agendar horário'));
assert.ok(checklist.includes('/conversa?agendarTask='));
assert.ok(checklist.includes('encodeURIComponent(item.id)'));
assert.ok(!checklist.includes('encodeURIComponent(item.title)'));

assert.ok(page.includes("const rawTaskId = params.agendarTask"));
assert.ok(page.includes(".eq('id', taskId)"));
assert.ok(page.includes(".eq('user_id', userId)"));
assert.ok(page.includes(".eq('status', 'pending')"));
assert.ok(page.includes(".eq('needs_confirmation', false)"));
assert.ok(page.includes('<ConversationPanel scheduleTaskTitle={scheduleTaskTitle} />'));
assert.ok(!page.includes('service_role'));
assert.ok(!page.includes('createAdminClient'));

assert.ok(panel.includes("scheduleTaskTitle ? 'Que horário?'"));
assert.ok(panel.includes('Diga apenas o horário de hoje'));
assert.ok(panel.includes('`Agende ${scheduleTaskTitle} hoje às ${trimmed}`'));
assert.ok(panel.includes('sendConversationMessage(backendText, timezone)'));
assert.ok(!panel.includes('access_token'));
assert.ok(!panel.includes('refresh_token'));
assert.ok(!panel.includes('service_role'));

console.log('[PASS] checklist abre agendamento usando apenas id opaco da tarefa');
console.log('[PASS] servidor resolve título somente para tarefa pendente confirmada do próprio usuário');
console.log('[PASS] usuário pode dizer apenas o horário e continua passando pela confirmação existente');
console.log('[PASS] nenhuma credencial ou escrita de agenda foi movida para o cliente');
