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
const cancelSection = section(
  'export async function cancelTask(',
  'export async function cancelTaskAction(',
);

check('ações usam sessão autenticada e nunca admin client', () => {
  for (const part of [completeSection, cancelSection]) {
    assert.ok(part.includes('await createClient()'));
    assert.ok(part.includes('supabase.auth.getClaims()'));
    assert.ok(part.includes('claims?.claims.sub'));
    assert.ok(!part.includes('createAdminClient'));
    assert.ok(!part.includes('service_role'));
  }
});

check('completeTask faz somente pending -> completed com ownership e confirmação', () => {
  assert.ok(completeSection.includes(".update({ status: 'completed' })"));
  assert.ok(completeSection.includes(".eq('id', taskId)"));
  assert.ok(completeSection.includes(".eq('user_id', userId)"));
  assert.ok(completeSection.includes(".eq('status', 'pending')"));
  assert.ok(completeSection.includes(".eq('needs_confirmation', false)"));
  assert.ok(!completeSection.includes("'cancelled'"));
});

check('cancelTask faz somente pending -> cancelled com ownership e confirmação', () => {
  assert.ok(cancelSection.includes(".update({ status: 'cancelled' })"));
  assert.ok(cancelSection.includes(".eq('id', taskId)"));
  assert.ok(cancelSection.includes(".eq('user_id', userId)"));
  assert.ok(cancelSection.includes(".eq('status', 'pending')"));
  assert.ok(cancelSection.includes(".eq('needs_confirmation', false)"));
  assert.ok(!cancelSection.includes("'completed'"));
});

check('nenhuma ação faz leitura prévia, delete, insert, upsert ou RPC', () => {
  for (const part of [completeSection, cancelSection]) {
    assert.match(part, /\.from\('items'\)\s*\.update\(/);
    for (const forbidden of ['.delete(', '.insert(', '.upsert(', '.rpc(']) {
      assert.ok(!part.includes(forbidden), `operação proibida: ${forbidden}`);
    }
  }
});

check('as duas ações revalidam /tarefas e /hoje somente após sucesso', () => {
  for (const part of [completeSection, cancelSection]) {
    const notFoundIndex = part.indexOf('if (data === null)');
    const tarefasIndex = part.indexOf("revalidatePath('/tarefas')");
    const hojeIndex = part.indexOf("revalidatePath('/hoje')");
    assert.ok(notFoundIndex !== -1 && tarefasIndex !== -1 && hojeIndex !== -1);
    assert.ok(tarefasIndex > notFoundIndex);
    assert.ok(hojeIndex > notFoundIndex);
  }
});

check('wrappers de form apenas delegam para as funções seguras', () => {
  const completeWrapper = section(
    'export async function completeTaskAction(',
    'export async function cancelTask(',
  );
  const cancelWrapper = section('export async function cancelTaskAction(', null);
  assert.ok(completeWrapper.includes('await completeTask(taskId)'));
  assert.ok(cancelWrapper.includes('await cancelTask(taskId)'));
  for (const part of [completeWrapper, cancelWrapper]) {
    for (const forbidden of ['.update(', '.delete(', '.insert(', '.upsert(', '.rpc(']) {
      assert.ok(!part.includes(forbidden), `mutação indevida no wrapper: ${forbidden}`);
    }
  }
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
