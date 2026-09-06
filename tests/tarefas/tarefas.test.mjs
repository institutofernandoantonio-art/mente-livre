// Testes unitários de apresentação + auditoria estática da rota /tarefas.
//
// Execução: npm run test:tarefas
//
// A página é um Server Component e o projeto não usa renderer de React nos
// testes desta camada. Por isso os invariantes de segurança e composição da
// UI são auditados diretamente no código-fonte real, seguindo o padrão já
// adotado pelo projeto.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { statusLabel, formatDeadline } from '../../src/app/tarefas/presentation.ts';

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

function readCodeOnly(relativePath) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = readFileSync(path, 'utf8');
  return source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const pageCode = readCodeOnly('../../src/app/tarefas/page.tsx');
const proxyCode = readCodeOnly('../../src/proxy.ts');
const conversaPageCode = readCodeOnly('../../src/app/conversa/page.tsx');

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

check("1. statusLabel('pending') -> 'Pendente'", () => {
  assert.equal(statusLabel('pending'), 'Pendente');
});

check("2. statusLabel('completed') -> 'Concluída'", () => {
  assert.equal(statusLabel('completed'), 'Concluída');
});

check("3. statusLabel('cancelled') -> 'Cancelada'", () => {
  assert.equal(statusLabel('cancelled'), 'Cancelada');
});

check('4. status desconhecido preserva o valor bruto', () => {
  assert.equal(statusLabel('algo-novo'), 'algo-novo');
});

check('5. formatDeadline(null) -> null', () => {
  assert.equal(formatDeadline(null), null);
});

check('6. formatDeadline formata ISO válido sem devolver o valor bruto', () => {
  const raw = '2026-09-01T15:00:00.000Z';
  const result = formatDeadline(raw);
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
  assert.notEqual(result, raw);
});

check('7. formatDeadline inválido usa fallback sem esconder o dado', () => {
  assert.equal(formatDeadline('não-é-uma-data'), 'não-é-uma-data');
});

// ---------------------------------------------------------------------------
// Auth, isolamento e leitura
// ---------------------------------------------------------------------------

check('8. página usa createClient normal + getClaims server-side', () => {
  assert.ok(pageCode.includes("from '@/lib/supabase/server'"));
  assert.ok(pageCode.includes('createClient()'));
  assert.ok(pageCode.includes('getClaims()'));
});

check('9. userId é derivado da sessão, nunca de input externo', () => {
  assert.ok(pageCode.includes('claims?.claims.sub'));
  const forbidden = ['searchParams', 'params:', 'formData', 'cookies.get(', 'localStorage', 'request.'];
  for (const token of forbidden) {
    assert.ok(!pageCode.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('10. página nunca usa admin client/service role', () => {
  const forbidden = ['createAdminClient', 'service_role', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  for (const token of forbidden) {
    assert.ok(!pageCode.includes(token), `token proibido encontrado: ${token}`);
  }
});

check("11. consulta items com isolamento explícito e apenas itens confirmados", () => {
  assert.ok(pageCode.includes("from('items')"));
  assert.ok(pageCode.includes(".eq('user_id', userId)"));
  assert.ok(pageCode.includes(".eq('needs_confirmation', false)"));
});

check('12. leitura inclui priority já existente e mantém created_at DESC', () => {
  assert.ok(pageCode.includes(".select('id, title, status, deadline_at, priority')"));
  assert.ok(pageCode.includes(".order('created_at', { ascending: false })"));
});

check('13. Server Component continua read-only; mutações ficam nas Server Actions', () => {
  const forbidden = ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc('];
  for (const token of forbidden) {
    assert.ok(!pageCode.includes(token), `mutação direta encontrada: ${token}`);
  }
});

// ---------------------------------------------------------------------------
// IDs internos e composição das ações
// ---------------------------------------------------------------------------

check('14. nenhum id interno é renderizado ou exposto como texto', () => {
  for (const token of ['proposalId', 'proposal_id', 'brainDumpId', 'brain_dump_id', 'userId']) {
    if (token === 'userId') continue; // userId é variável server-side legítima.
    assert.ok(!pageCode.includes(token), `id interno indevido encontrado: ${token}`);
  }
  assert.ok(!/>\s*\{task\.id\}\s*</.test(pageCode), 'task.id nunca pode ser conteúdo visual');
});

check('15. task.id só é usado como key e argumento das três ações permitidas', () => {
  const occurrences = pageCode.split('task.id').length - 1;
  assert.equal(occurrences, 4, 'esperado: key + prioridade + concluir + cancelar');
  assert.ok(pageCode.includes('key={task.id}'));
  assert.ok(pageCode.includes('setTaskPriorityAction.bind(null, task.id, option.value)'));
  assert.ok(pageCode.includes('completeTaskAction.bind(null, task.id)'));
  assert.ok(pageCode.includes('cancelTaskAction.bind(null, task.id)'));
});

check('16. mutações são importadas de módulos use-server, nunca definidas na página', () => {
  assert.ok(pageCode.includes("from './actions'"));
  assert.ok(pageCode.includes("from './priority-actions'"));
  for (const fn of ['completeTaskAction', 'cancelTaskAction', 'setTaskPriorityAction']) {
    assert.ok(pageCode.includes(fn));
    assert.ok(!new RegExp(`function\\s+${fn}`).test(pageCode), `${fn} não deve ser definida em page.tsx`);
  }
});

// ---------------------------------------------------------------------------
// UI mínima de prioridade
// ---------------------------------------------------------------------------

check('17. opções permitidas são exatamente alta, média e baixa', () => {
  assert.ok(pageCode.includes("{ value: 'alta', label: 'Alta' }"));
  assert.ok(pageCode.includes("{ value: 'média', label: 'Média' }"));
  assert.ok(pageCode.includes("{ value: 'baixa', label: 'Baixa' }"));
  const optionEntries = [...pageCode.matchAll(/\{ value: '(alta|média|baixa)', label: '[^']+' \}/g)];
  assert.equal(optionEntries.length, 3);
});

check('18. prioridade atual é mostrada sem criar lógica de Eisenhower nesta subfase', () => {
  assert.ok(pageCode.includes('priorityLabel(task.priority)'));
  assert.ok(pageCode.includes('Sem prioridade'));
  assert.ok(!/eisenhower/i.test(pageCode));
});

check('19. controles de prioridade só existem dentro do bloco de tarefa pending', () => {
  const pendingIndex = pageCode.indexOf("task.status === 'pending'");
  const priorityActionIndex = pageCode.indexOf('setTaskPriorityAction.bind(null, task.id, option.value)');
  const completeIndex = pageCode.indexOf('completeTaskAction.bind(null, task.id)');
  const cancelIndex = pageCode.indexOf('cancelTaskAction.bind(null, task.id)');
  assert.ok(pendingIndex !== -1);
  assert.ok(pendingIndex < priorityActionIndex);
  assert.ok(pendingIndex < completeIndex);
  assert.ok(pendingIndex < cancelIndex);
  assert.equal(pageCode.split("task.status === 'pending'").length - 1, 1);
});

check('20. opção atualmente selecionada usa variant secondary; demais usam ghost', () => {
  assert.ok(pageCode.includes("variant={task.priority === option.value ? 'secondary' : 'ghost'}"));
});

check('21. concluir e cancelar preservam os contratos visuais existentes', () => {
  assert.ok(/variant="secondary">\s*Concluir/.test(pageCode));
  assert.ok(/variant="ghost">\s*Cancelar/.test(pageCode));
});

check('22. estado vazio e erro continuam usando componentes compartilhados', () => {
  assert.ok(pageCode.includes("from '@/components/ui/EmptyState'"));
  assert.ok(pageCode.includes('<EmptyState'));
  assert.ok(pageCode.includes("from '@/components/ui/ErrorState'"));
  assert.ok(pageCode.includes('<ErrorState'));
});

// ---------------------------------------------------------------------------
// Proteção de rota e navegação
// ---------------------------------------------------------------------------

check("23. '/tarefas' continua protegida por AAL2", () => {
  const match = proxyCode.match(/AAL2_REQUIRED_PATHS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  assert.ok(match, 'AAL2_REQUIRED_PATHS não encontrado');
  assert.ok(match[1].includes("'/tarefas'"));
  assert.ok(match[1].includes("'/entrada'"));
  assert.ok(match[1].includes("'/conversa'"));
});

check("24. /tarefas mantém retorno para /conversa e /conversa mantém acesso a /tarefas", () => {
  assert.ok(pageCode.includes('href="/conversa"'));
  assert.ok(conversaPageCode.includes('href="/tarefas"') || conversaPageCode.includes("href='/tarefas'"));
});

check('25. conversa/page.tsx continua sem lógica de tarefas ou Supabase', () => {
  const forbidden = ['sendConversationMessage', 'getRuntimeState', "from('items')", 'setTaskPriorityAction'];
  for (const token of forbidden) {
    assert.ok(!conversaPageCode.includes(token), `lógica indevida em conversa/page.tsx: ${token}`);
  }
});

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
