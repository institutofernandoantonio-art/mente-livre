// Auditoria estática de src/app/tarefas/actions.ts (Server Action
// `completeTask`).
//
// Execução: npm run test:tasks-actions
//
// Por que auditoria estática, não teste dinâmico com dublê de Supabase:
// `actions.ts` importa `createClient` de `@/lib/supabase/server` (alias de
// path só resolvido por Next.js/tsconfig, nunca pelo resolvedor puro do
// Node) — mesmo padrão já usado por TODO Server Component/Action dentro
// de `src/app/` que toca Supabase diretamente (`entrada/page.tsx`,
// `supabase/actions.ts`, `google/calendar.ts`), nenhum dos quais tem teste
// dinâmico com dublê neste projeto. Criar um dublê genérico para a cadeia
// fluente `.from().update().eq()...select().maybeSingle()` seria inventar
// uma abstração de teste nova sem precedente (e arriscaria divergir do
// comportamento real do client) — em vez disso, seguimos exatamente o
// mesmo padrão já usado para `page.tsx`/`proxy.ts`/`ConversationPanel.tsx`
// nesta mesma pasta: ler o arquivo-fonte real e auditar sua estrutura. O
// comportamento dinâmico real é coberto pelo teste manual de ponta a
// ponta contra o banco real (mais confiável que um dublê hand-rolled).

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

check('1. "use server" presente', () => {
  assert.ok(codeOnly.includes("'use server'"));
});

check("2. CompleteTaskResult tem exatamente os 3 status esperados, nenhum a mais", () => {
  const match = codeOnly.match(/export type CompleteTaskResult =([^;]*);/);
  assert.ok(match, 'tipo CompleteTaskResult não encontrado');
  const body = match[1];
  for (const status of ['completed', 'not_found', 'error']) {
    assert.ok(body.includes(`'${status}'`), `status ausente: ${status}`);
  }
  // Nunca distinguir forbidden/already_completed/cancelled/needs_confirmation
  // — todos devem colapsar em 'not_found' (ver relatório de mapeamento).
  for (const forbidden of ['forbidden', 'already_completed', 'cancelled', 'needs_confirmation']) {
    assert.ok(!body.includes(`'${forbidden}'`), `status indevido encontrado: ${forbidden}`);
  }
});

check('3. assinatura pública aceita SÓ "taskId: string" — sem userId/segundo parâmetro', () => {
  const match = codeOnly.match(/export async function completeTask\(([^)]*)\)/s);
  assert.ok(match, 'assinatura pública não encontrada');
  const params = match[1].trim();
  assert.equal(params, 'taskId: string', 'assinatura deve ter exatamente um parâmetro: taskId: string');
});

check('4. input inválido (taskId vazio/não-string) é checado ANTES de qualquer chamada a createClient()', () => {
  const invalidCheckIndex = codeOnly.indexOf('isNonBlankString(taskId)');
  const createClientCallIndex = codeOnly.indexOf('await createClient()');
  assert.ok(invalidCheckIndex !== -1, 'checagem de input inválido não encontrada');
  assert.ok(createClientCallIndex !== -1, 'chamada a createClient() não encontrada');
  assert.ok(invalidCheckIndex < createClientCallIndex, 'input deve ser validado antes de qualquer I/O');
});

check('5. auth via createClient() normal + getClaims(), userId de claims.sub', () => {
  assert.ok(codeOnly.includes("from '@/lib/supabase/server'"));
  assert.ok(codeOnly.includes('await createClient()'));
  assert.ok(codeOnly.includes('supabase.auth.getClaims()'));
  assert.ok(codeOnly.includes('claims?.claims.sub'));
});

check('6. ausência de userId -> error, antes de qualquer update', () => {
  const userIdCheckIndex = codeOnly.indexOf('if (!userId)');
  const updateCallIndex = codeOnly.indexOf(".update({ status: 'completed' })");
  assert.ok(userIdCheckIndex !== -1 && updateCallIndex !== -1);
  assert.ok(userIdCheckIndex < updateCallIndex);
});

check('7. update tem exatamente os 4 filtros exigidos: id, user_id, status=pending, needs_confirmation=false', () => {
  assert.ok(codeOnly.includes(".eq('id', taskId)"));
  assert.ok(codeOnly.includes(".eq('user_id', userId)"));
  assert.ok(codeOnly.includes(".eq('status', 'pending')"));
  assert.ok(codeOnly.includes(".eq('needs_confirmation', false)"));
});

check("8. update usa .select('id').maybeSingle() (mesmo padrão de saber se algo foi afetado)", () => {
  assert.ok(codeOnly.includes(".select('id')"));
  assert.ok(codeOnly.includes('.maybeSingle()'));
});

check('9. zero leitura prévia — .from(\'items\') encadeia DIRETO em .update(, nunca um .select( isolado antes', () => {
  // O único `.from('items')` do arquivo (confirmado no teste 11) deve
  // encadear diretamente em `.update(` — prova de que é a MESMA chamada,
  // nunca uma consulta de leitura separada seguida de um update depois.
  assert.ok(
    /\.from\('items'\)\s*\.update\(/.test(codeOnly),
    "'.from(\'items\')' deve encadear diretamente em '.update(', sem leitura prévia",
  );
});

check('10. exatamente 1 chamada de update em todo o arquivo (zero retry)', () => {
  const occurrences = codeOnly.split('.update(').length - 1;
  assert.equal(occurrences, 1, 'deve haver exatamente 1 chamada a .update(');
});

check('11. zero segunda query explicativa (só 1 uso de .from() em todo o arquivo)', () => {
  const occurrences = codeOnly.split(".from('items')").length - 1;
  assert.equal(occurrences, 1, 'deve haver exatamente 1 uso de .from(\'items\')');
});

check('12. zero admin client / service role / RPC / mutações proibidas', () => {
  const forbidden = [
    'createAdminClient',
    'service_role',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    '.rpc(',
    '.insert(',
    '.delete(',
    '.upsert(',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

check("13. revalidatePath('/tarefas') presente e ocorre SOMENTE no ramo de sucesso (após o check de not_found)", () => {
  assert.ok(codeOnly.includes("revalidatePath('/tarefas')"));
  const notFoundIndex = codeOnly.indexOf("if (data === null)");
  const revalidateIndex = codeOnly.indexOf("revalidatePath('/tarefas')");
  assert.ok(notFoundIndex !== -1 && revalidateIndex !== -1);
  assert.ok(revalidateIndex > notFoundIndex, 'revalidatePath deve vir depois do branch not_found, nunca antes');
  // Exatamente 1 chamada — nunca revalidado em not_found/error.
  const occurrences = codeOnly.split('revalidatePath(').length - 1;
  assert.equal(occurrences, 1);
});

check('14. exceptions inesperadas mapeadas para error via catch estreito, nunca logadas cruas', () => {
  assert.ok(/catch\s*\{/.test(codeOnly), 'catch estreito (sem binding de erro) não encontrado');
  const forbidden = ['console.log', 'console.error', 'console.warn'];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `log proibido encontrado: ${token}`);
  }
});

check('15. zero mensagem/detalhe cru do Supabase exposta no retorno (nunca error.message/error.details)', () => {
  const forbidden = ['error.message', 'error.details', 'error.hint', 'error.code'];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `detalhe cru de erro encontrado: ${token}`);
  }
});

check('16. updated_at nunca setado manualmente (trigger existente já cuida disso)', () => {
  assert.ok(!codeOnly.includes('updated_at'));
});

check('17. zero id interno (proposalId/brainDumpId/stateId) referenciado', () => {
  const forbidden = ['proposalId', 'proposal_id', 'brainDumpId', 'brain_dump_id', 'stateId'];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `id interno indevido encontrado: ${token}`);
  }
});

// ============================================================================
// 18-19. completeTaskAction — wrapper void exigido pelo contrato de
// `<form action={...}>` (React rejeita uma função comum de Server
// Component nesse ponto; precisa ser exportado de um módulo 'use server' —
// ver comentário do próprio arquivo-fonte e o erro real reproduzido no
// teste manual desta subfase).
// ============================================================================

check("18. completeTaskAction exportado com assinatura (taskId: string): Promise<void>", () => {
  const match = codeOnly.match(/export async function completeTaskAction\(([^)]*)\): Promise<void> \{([^}]*)\}/);
  assert.ok(match, 'completeTaskAction não encontrado com a assinatura esperada');
  assert.equal(match[1].trim(), 'taskId: string');
});

check('19. completeTaskAction só delega para completeTask e descarta o resultado, nunca reimplementa mutação', () => {
  const match = codeOnly.match(/export async function completeTaskAction\([^)]*\): Promise<void> \{([^}]*)\}/);
  assert.ok(match, 'corpo de completeTaskAction não encontrado');
  const body = match[1];
  assert.ok(body.includes('await completeTask(taskId)'));
  const forbidden = ['.update(', '.delete(', '.upsert(', '.rpc(', "from('items')"];
  for (const token of forbidden) {
    assert.ok(!body.includes(token), `mutação indevida encontrada dentro do wrapper: ${token}`);
  }
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
