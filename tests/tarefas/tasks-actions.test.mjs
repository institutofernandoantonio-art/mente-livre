import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('../../src/app/tarefas/actions.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

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

function section(startMarker, endMarker) {
  const start = codeOnly.indexOf(startMarker);
  const end = endMarker ? codeOnly.indexOf(endMarker, start) : codeOnly.length;
  assert.ok(start !== -1, `seção não encontrada: ${startMarker}`);
  assert.ok(end !== -1, `fim da seção não encontrado: ${endMarker}`);
  return codeOnly.slice(start, end);
}

const completeSection = section(
  'export async function completeTask(',
  'export async function completeTaskAction(',
);
const completeWrapper = section(
  'export async function completeTaskAction(',
  'export async function cancelTask(',
);
const cancelSection = section(
  'export async function cancelTask(',
  'export async function cancelTaskAction(',
);
const cancelWrapper = section('export async function cancelTaskAction(', null);

check('módulo continua sendo exclusivamente server-side', () => {
  assert.ok(source.startsWith("'use server';"));
  assert.ok(!source.includes("'use client'"));
});

check('ids vazios falham fechado antes de qualquer I/O', () => {
  for (const part of [completeSection, cancelSection]) {
    const validationIndex = part.indexOf("if (!isNonBlankString(taskId)) return { status: 'not_found' }");
    const clientIndex = part.indexOf('await createClient()');
    assert.ok(validationIndex !== -1);
    assert.ok(clientIndex !== -1);
    assert.ok(validationIndex < clientIndex);
  }
});

check('ações usam cliente autenticado normal e derivam usuário da sessão', () => {
  for (const part of [completeSection, cancelSection]) {
    assert.ok(part.includes('await createClient()'));
    assert.ok(part.includes('supabase.auth.getClaims()'));
    assert.ok(part.includes('claims?.claims.sub'));
    assert.ok(!part.includes('createAdminClient'));
    assert.ok(!part.includes('service_role'));
  }
});

check('ausência de usuário autenticado falha como erro sem mutação alternativa', () => {
  for (const part of [completeSection, cancelSection]) {
    assert.ok(part.includes("if (!userId) return { status: 'error' }"));
  }
});

check('completeTask faz somente pending -> completed', () => {
  assert.ok(completeSection.includes(".update({ status: 'completed', completed_at: completedAt })"));
  assert.ok(completeSection.includes('const completedAt = new Date().toISOString()'));
  assert.ok(!completeSection.includes("status: 'cancelled'"));
});

check('completeTask exige id exato da tarefa', () => {
  assert.ok(completeSection.includes(".eq('id', taskId)"));
});

check('completeTask exige ownership explícito', () => {
  assert.ok(completeSection.includes(".eq('user_id', userId)"));
});

check('completeTask só alcança tarefa pendente', () => {
  assert.ok(completeSection.includes(".eq('status', 'pending')"));
});

check('completeTask só alcança tarefa já confirmada', () => {
  assert.ok(completeSection.includes(".eq('needs_confirmation', false)"));
});

check('cancelTask faz somente pending -> cancelled e nunca grava completed_at', () => {
  assert.ok(cancelSection.includes(".update({ status: 'cancelled' })"));
  assert.ok(!cancelSection.includes("status: 'completed'"));
  assert.ok(!cancelSection.includes('completed_at'));
});

check('cancelTask exige id exato da tarefa', () => {
  assert.ok(cancelSection.includes(".eq('id', taskId)"));
});

check('cancelTask exige ownership explícito', () => {
  assert.ok(cancelSection.includes(".eq('user_id', userId)"));
});

check('cancelTask só alcança tarefa pendente', () => {
  assert.ok(cancelSection.includes(".eq('status', 'pending')"));
});

check('cancelTask só alcança tarefa já confirmada', () => {
  assert.ok(cancelSection.includes(".eq('needs_confirmation', false)"));
});

check('mutações usam uma única UPDATE em items, sem leitura prévia ou operação ampla', () => {
  for (const part of [completeSection, cancelSection]) {
    assert.match(part, /\.from\('items'\)\s*\.update\(/);
    assert.equal((part.match(/\.from\('items'\)/g) ?? []).length, 1);
    assert.equal((part.match(/\.update\(/g) ?? []).length, 1);
    for (const forbidden of ['.delete(', '.insert(', '.upsert(', '.rpc(']) {
      assert.ok(!part.includes(forbidden), `operação proibida: ${forbidden}`);
    }
  }
});

check('resultado da mutação retorna somente id e usa maybeSingle', () => {
  for (const part of [completeSection, cancelSection]) {
    assert.ok(part.includes(".select('id')"));
    assert.ok(part.includes('.maybeSingle()'));
  }
});

check('erro de banco nunca é tratado como sucesso', () => {
  for (const part of [completeSection, cancelSection]) {
    const errorIndex = part.indexOf("if (error) return { status: 'error' }");
    const revalidateIndex = part.indexOf("revalidatePath('/tarefas')");
    assert.ok(errorIndex !== -1 && revalidateIndex !== -1);
    assert.ok(errorIndex < revalidateIndex);
  }
});

check('nenhuma linha alterada vira not_found antes da revalidação', () => {
  for (const part of [completeSection, cancelSection]) {
    const notFoundIndex = part.indexOf("if (data === null) return { status: 'not_found' }");
    const revalidateIndex = part.indexOf("revalidatePath('/tarefas')");
    assert.ok(notFoundIndex !== -1 && revalidateIndex !== -1);
    assert.ok(notFoundIndex < revalidateIndex);
  }
});

check('as duas ações revalidam tarefas e Hoje somente depois do sucesso da mutação', () => {
  for (const part of [completeSection, cancelSection]) {
    const notFoundIndex = part.indexOf("if (data === null) return { status: 'not_found' }");
    const tarefasIndex = part.indexOf("revalidatePath('/tarefas')");
    const hojeIndex = part.indexOf("revalidatePath('/hoje')");
    assert.ok(notFoundIndex !== -1 && tarefasIndex !== -1 && hojeIndex !== -1);
    assert.ok(tarefasIndex > notFoundIndex);
    assert.ok(hojeIndex > notFoundIndex);
    assert.equal((part.match(/revalidatePath\('/g) ?? []).length, 2);
  }
});

check('completeTask retorna completed somente após revalidação', () => {
  const hojeIndex = completeSection.indexOf("revalidatePath('/hoje')");
  const successIndex = completeSection.lastIndexOf("return { status: 'completed' }");
  assert.ok(hojeIndex !== -1 && successIndex > hojeIndex);
});

check('cancelTask retorna cancelled somente após revalidação', () => {
  const hojeIndex = cancelSection.indexOf("revalidatePath('/hoje')");
  const successIndex = cancelSection.lastIndexOf("return { status: 'cancelled' }");
  assert.ok(hojeIndex !== -1 && successIndex > hojeIndex);
});

check('exceções inesperadas falham fechado como error', () => {
  for (const part of [completeSection, cancelSection]) {
    assert.ok(part.includes("catch {\n    return { status: 'error' };\n  }"));
  }
});

check('wrappers de formulário apenas delegam para as funções seguras', () => {
  assert.ok(completeWrapper.includes('await completeTask(taskId)'));
  assert.ok(cancelWrapper.includes('await cancelTask(taskId)'));
  for (const part of [completeWrapper, cancelWrapper]) {
    for (const forbidden of ['createClient(', 'getClaims(', '.from(', '.update(', '.delete(', '.insert(', '.upsert(', '.rpc(', 'revalidatePath(']) {
      assert.ok(!part.includes(forbidden), `lógica indevida no wrapper: ${forbidden}`);
    }
  }
});

check('nenhuma ação aceita userId externo nem contém lógica de Google/IA', () => {
  for (const part of [completeSection, cancelSection]) {
    assert.ok(!/function\s+\w+\([^)]*userId/u.test(part));
    for (const forbidden of ['Google', 'Anthropic', 'OpenAI', 'fetch(']) {
      assert.ok(!part.includes(forbidden), `dependência indevida: ${forbidden}`);
    }
  }
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
