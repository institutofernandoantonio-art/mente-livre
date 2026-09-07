import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const actionPath = fileURLToPath(new URL('../../src/app/tarefas/priority-actions.ts', import.meta.url));
const pagePath = fileURLToPath(new URL('../../src/app/tarefas/page.tsx', import.meta.url));
const action = readFileSync(actionPath, 'utf8');
const page = readFileSync(pagePath, 'utf8');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`[PASS] ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`[FAIL] ${name} — ${error.message}`);
  }
}

check('aceita alta, média, baixa e null para remover prioridade', () => {
  for (const value of ["'alta'", "'média'", "'baixa'"]) assert.ok(action.includes(value));
  assert.ok(action.includes('TaskPriority | null'));
  assert.ok(action.includes('value === null'));
  assert.ok(action.includes("status: 'invalid_priority'"));
});

check('mutação usa sessão autenticada e RLS, sem admin client', () => {
  assert.ok(action.includes('supabase.auth.getClaims()'));
  assert.ok(action.includes('claims?.claims.sub'));
  assert.ok(action.includes(".eq('user_id', userId)"));
  assert.ok(!action.includes('createAdminClient'));
  assert.ok(!action.includes('service_role'));
});

check('só altera tarefa confirmada e pendente', () => {
  assert.ok(action.includes(".eq('status', 'pending')"));
  assert.ok(action.includes(".eq('needs_confirmation', false)"));
  assert.ok(action.includes('.update({ priority })'));
});

check('não cria, apaga ou usa RPC', () => {
  for (const forbidden of ['.insert(', '.delete(', '.upsert(', '.rpc(']) {
    assert.ok(!action.includes(forbidden), `operação proibida encontrada: ${forbidden}`);
  }
});

check('mudança de prioridade revalida tarefas e o foco de Hoje', () => {
  assert.ok(action.includes("revalidatePath('/tarefas')"));
  assert.ok(action.includes("revalidatePath('/hoje')"));
});

check('UI lê priority, oferece os três níveis e permite limpar', () => {
  assert.ok(page.includes("select('id, title, status, deadline_at, priority')"));
  assert.ok(page.includes("value: 'alta'"));
  assert.ok(page.includes("value: 'média'"));
  assert.ok(page.includes("value: 'baixa'"));
  assert.ok(page.includes('setTaskPriorityAction.bind(null, task.id, null)'));
  assert.ok(page.includes('Sem prioridade'));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
