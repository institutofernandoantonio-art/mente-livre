import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const actions = readFileSync(new URL('../../src/app/hoje/checklist-actions.ts', import.meta.url), 'utf8');
const component = readFileSync(new URL('../../src/app/hoje/TodayChecklist.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../src/app/hoje/page.tsx', import.meta.url), 'utf8');
const conversaPage = readFileSync(new URL('../../src/app/conversa/page.tsx', import.meta.url), 'utf8');
const conversaPanel = readFileSync(new URL('../../src/app/conversa/ConversationPanel.tsx', import.meta.url), 'utf8');

assert.ok(actions.includes("'use server'"));
assert.ok(actions.includes(".eq('user_id', userId)"));
assert.ok(actions.includes(".eq('status', 'pending')"));
assert.ok(actions.includes(".eq('needs_confirmation', false)"));
assert.ok(actions.includes(".gte('deadline_at', start.utc.toISOString())"));
assert.ok(actions.includes(".lt('deadline_at', end.utc.toISOString())"));
assert.ok(actions.includes('isValidTimeZone(timeZone)'));
assert.ok(!actions.includes('service_role'));
assert.ok(!actions.includes('createAdminClient'));

assert.ok(component.includes('Checklist do dia'));
assert.ok(component.includes('Para fazer hoje, sem horário marcado'));
assert.ok(component.includes('Decida em um toque o que merece sua atenção.'));
assert.ok(component.includes('Fazer hoje'));
assert.ok(component.includes('Urgente + importante'));
assert.ok(component.includes('Planejar'));
assert.ok(component.includes('Delegar'));
assert.ok(component.includes('Depois'));
assert.ok(component.includes('setTaskPriority(taskId, priority)'));
assert.ok(component.includes("completeTask(taskId)"));
assert.ok(component.includes("state.items.filter((item) => item.id !== taskId)"));
assert.ok(component.includes('Agendar horário'));
assert.ok(component.includes('/conversa?agendarTask='));
assert.ok(component.includes('encodeURIComponent(item.id)'));
assert.ok(!component.includes('encodeURIComponent(item.title)'));
assert.ok(!component.includes('Google Calendar'));
assert.ok(!component.includes('create_event'));

assert.ok(conversaPage.includes('const rawTaskId = params.agendarTask'));
assert.ok(conversaPage.includes(".eq('id', taskId)"));
assert.ok(conversaPage.includes(".eq('user_id', userId)"));
assert.ok(conversaPage.includes(".eq('status', 'pending')"));
assert.ok(conversaPage.includes(".eq('needs_confirmation', false)"));
assert.ok(conversaPage.includes('<ConversationPanel scheduleTaskTitle={scheduleTaskTitle} />'));
assert.ok(!conversaPage.includes('service_role'));
assert.ok(!conversaPage.includes('createAdminClient'));

assert.ok(conversaPanel.includes("scheduleTaskTitle ? 'Que horário?'"));
assert.ok(conversaPanel.includes('Diga apenas o horário de hoje'));
assert.ok(conversaPanel.includes('`Agende ${scheduleTaskTitle} hoje às ${trimmed}`'));
assert.ok(conversaPanel.includes("const isConfirmation = /^(sim|n[aã]o)$/iu.test(trimmed)"));
assert.ok(conversaPanel.includes('scheduleTaskTitle && !alreadyExplicit && !isConfirmation'));
assert.ok(conversaPanel.includes('sendConversationMessage(backendText, timezone)'));
assert.ok(!conversaPanel.includes('access_token'));
assert.ok(!conversaPanel.includes('refresh_token'));
assert.ok(!conversaPanel.includes('service_role'));

assert.ok(page.includes("import { TodayChecklist } from './TodayChecklist'"));
assert.ok(page.includes('<TodayChecklist />'));

console.log('[PASS] checklist do dia usa apenas tarefas pendentes e confirmadas do usuário');
console.log('[PASS] recorte de hoje respeita timezone civil do aparelho');
console.log('[PASS] Eisenhower é apresentado em linguagem simples e resolvido em um toque');
console.log('[PASS] agendar horário usa apenas id opaco e resolve a tarefa no servidor por usuário');
console.log('[PASS] usuário pode dizer apenas o horário e sim/não continuam sendo confirmação');
console.log('[PASS] checklist permite concluir sem criar evento no Google Calendar');
console.log('[PASS] tela Hoje incorpora o checklist');
