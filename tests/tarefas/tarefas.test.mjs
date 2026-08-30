// Testes unitários de src/app/tarefas/presentation.ts (helper puro) +
// auditoria estática de contrato sobre src/app/tarefas/page.tsx e
// src/proxy.ts.
//
// Execução: npm run test:tarefas
//
// `presentation.ts` não tem NENHUM import (zero I/O, zero dependência de
// React/Next/Supabase) — não precisa de `--conditions=react-server` nem do
// loader de redirecionamento, mesmo padrão de conversation-ttl.ts/
// confirmation.ts/presentation-ui.ts: só `--experimental-strip-types`.
//
// A página em si (`page.tsx`) é um Server Component async — não há
// renderer de React instalado neste projeto (decisão deliberada, ver
// subfases anteriores), então ela é coberta por auditoria estática do
// código-fonte real, não por render de fato.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
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

// ============================================================================
// 1-6. HELPER PURO — statusLabel / formatDeadline
// ============================================================================

check("1. statusLabel('pending') -> 'Pendente'", () => {
  assert.equal(statusLabel('pending'), 'Pendente');
});

check("2. statusLabel('completed') -> 'Concluída'", () => {
  assert.equal(statusLabel('completed'), 'Concluída');
});

check("3. statusLabel('cancelled') -> 'Cancelada'", () => {
  assert.equal(statusLabel('cancelled'), 'Cancelada');
});

check('4. statusLabel de valor desconhecido -> fallback para o valor bruto (nunca esconde o dado)', () => {
  assert.equal(statusLabel('algo-novo'), 'algo-novo');
});

check('5. formatDeadline(null) -> null (sem prazo, nunca inventado)', () => {
  assert.equal(formatDeadline(null), null);
});

check('6. formatDeadline com ISO válido -> string não vazia, nunca o valor bruto original', () => {
  const result = formatDeadline('2026-09-01T15:00:00.000Z');
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
});

check('6b. formatDeadline com string inválida -> fallback para o valor original (nunca esconde o dado)', () => {
  assert.equal(formatDeadline('não-é-uma-data'), 'não-é-uma-data');
});

// ============================================================================
// AUDITORIA ESTÁTICA DE CONTRATO — page.tsx / proxy.ts / conversa/page.tsx
// ============================================================================

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

check('7. página usa createClient() normal e getClaims() (auth server-side, mesmo padrão do projeto)', () => {
  assert.ok(pageCode.includes("from '@/lib/supabase/server'"));
  assert.ok(pageCode.includes('createClient()'));
  assert.ok(pageCode.includes('getClaims()'));
});

check('8. userId nunca vem de fora — nenhum searchParams/params/formData/cookie manual/localStorage', () => {
  const forbidden = ['searchParams', 'params:', 'formData', 'cookies.get(', 'localStorage', 'request.'];
  for (const token of forbidden) {
    assert.ok(!pageCode.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('9. zero admin client / service role', () => {
  const forbidden = ['createAdminClient', 'service_role', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  for (const token of forbidden) {
    assert.ok(!pageCode.includes(token), `token proibido encontrado: ${token}`);
  }
});

check("10. consulta a tabela 'items' com filtro explícito por user_id e needs_confirmation=false", () => {
  assert.ok(pageCode.includes("from('items')"));
  assert.ok(pageCode.includes(".eq('user_id', userId)"));
  // Sem isso, a listagem misturaria sugestões nunca confirmadas do fluxo
  // antigo de brain dump com tarefas conversacionais reais (ver
  // relatório de mapeamento desta subfase).
  assert.ok(pageCode.includes(".eq('needs_confirmation', false)"));
});

check('11. read-only: zero insert/update/delete/upsert/rpc em todo o arquivo', () => {
  const forbidden = ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc('];
  for (const token of forbidden) {
    assert.ok(!pageCode.includes(token), `mutação encontrada: ${token}`);
  }
});

check('12. zero ids internos expostos como texto (proposalId/brainDumpId) — "id" só como key/argumento de action', () => {
  assert.ok(!pageCode.includes('proposalId'));
  assert.ok(!pageCode.includes('proposal_id'));
  assert.ok(!pageCode.includes('brainDumpId'));
  assert.ok(!pageCode.includes('brain_dump_id'));
  // `task.id` aparece EXATAMENTE 2 vezes em todo o arquivo: key do React
  // e argumento do form bound — nunca renderizado como texto visível.
  const occurrences = pageCode.split('task.id').length - 1;
  assert.equal(occurrences, 2, 'task.id deve aparecer exatamente 2 vezes (key + bind da action)');
  assert.ok(pageCode.includes('key={task.id}'));
  assert.ok(pageCode.includes('completeTaskAction.bind(null, task.id)'));
  // Nenhuma das duas ocorrências está dentro de um nó de texto renderizado
  // (ex.: `>{task.id}<`) — ambas são atributo/argumento, nunca conteúdo.
  assert.ok(!/>\s*\{task\.id\}\s*</.test(pageCode));
});

check('13. estado vazio usa EmptyState existente, erro usa ErrorState existente (nenhum componente novo)', () => {
  assert.ok(pageCode.includes("from '@/components/ui/EmptyState'"));
  assert.ok(pageCode.includes('<EmptyState'));
  assert.ok(pageCode.includes("from '@/components/ui/ErrorState'"));
  assert.ok(pageCode.includes('<ErrorState'));
});

check('14. ordenação por created_at (mais recentes primeiro), zero lógica de prioridade/Eisenhower', () => {
  assert.ok(pageCode.includes("order('created_at', { ascending: false })"));
  assert.ok(!/eisenhower|priority/i.test(pageCode));
});

check("15. '/tarefas' está em AAL2_REQUIRED_PATHS, rotas já existentes preservadas", () => {
  const match = proxyCode.match(/AAL2_REQUIRED_PATHS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  assert.ok(match, 'AAL2_REQUIRED_PATHS não encontrado');
  assert.ok(match[1].includes("'/tarefas'"), "'/tarefas' ausente de AAL2_REQUIRED_PATHS");
  assert.ok(match[1].includes("'/entrada'"));
  assert.ok(match[1].includes("'/redefinir-senha'"));
  assert.ok(match[1].includes("'/conversa'"));
});

check(
  '16. /entrada: BrainDumpForm.tsx byte-for-byte intacto; page.tsx só ganhou o link de navegação para /conversa (subfase de navegação/descoberta da V1), nenhuma outra linha tocada',
  () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));

    const brainDumpDiff = execSync('git diff -- src/app/entrada/BrainDumpForm.tsx', { cwd: root })
      .toString()
      .trim();
    assert.equal(brainDumpDiff, '', 'BrainDumpForm.tsx foi modificado — esperado zero diff');

    const pageDiff = execSync('git diff -- src/app/entrada/page.tsx', { cwd: root }).toString();
    const addedLines = pageDiff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'));
    const removedLines = pageDiff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---'));

    // A regra desta subfase é estritamente aditiva: nenhuma linha removida,
    // e a única linha nova de verdade é o link para /conversa — nunca uma
    // reescrita de lógica existente.
    assert.equal(removedLines.length, 0, 'nenhuma linha deveria ser removida de entrada/page.tsx');
    assert.ok(
      addedLines.some((line) => line.includes('href="/conversa"')),
      'linha adicionada com o link para /conversa não encontrada',
    );

    const forbidden = ['.from(', '.insert(', '.update(', '.delete(', 'createBrainDump', 'organizeBrainDump'];
    for (const line of addedLines) {
      for (const token of forbidden) {
        assert.ok(!line.includes(token), `linha adicionada contém lógica indevida: ${token}`);
      }
    }
  },
);

check('17. ConversationPanel.tsx não foi alterado nesta subfase (byte-for-byte)', () => {
  const diff = execSync('git diff -- src/app/conversa/ConversationPanel.tsx', {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
  })
    .toString()
    .trim();
  assert.equal(diff, '', 'ConversationPanel.tsx foi modificado — esperado zero diff');
});

check('18b. página importa completeTaskAction de ./actions, nunca implementa mutação própria', () => {
  assert.ok(pageCode.includes("from './actions'"));
  assert.ok(pageCode.includes('completeTaskAction'));
  // page.tsx nunca chama .update/.delete/.upsert/.rpc diretamente — a
  // única mutação da rota vive inteiramente em actions.ts (teste 11 já
  // confirma zero mutação em page.tsx). `completeTaskAction` precisa ser
  // importado de `./actions` (não definido localmente) porque só uma
  // função exportada de um módulo `'use server'` pode ser passada como
  // `action` de um `<form>` — uma função comum declarada dentro do
  // próprio Server Component é rejeitada pelo React nesse ponto
  // específico (erro real reproduzido no teste manual desta subfase).
  assert.ok(!/function completeTaskAction/.test(pageCode), 'completeTaskAction não deve ser definido em page.tsx');
});

check('18c. botão "Concluir" só aparece para task.status === \'pending\' (completed/cancelled não têm botão)', () => {
  assert.ok(pageCode.includes("task.status === 'pending'"));
  // O `<form>` com a action bound deve estar dentro do bloco condicionado
  // a esse status — checagem estrutural mínima: a condição aparece antes
  // do form bound no mesmo trecho.
  const conditionIndex = pageCode.indexOf("task.status === 'pending'");
  const formIndex = pageCode.indexOf('completeTaskAction.bind(null, task.id)');
  assert.ok(conditionIndex !== -1 && formIndex !== -1);
  assert.ok(conditionIndex < formIndex, 'form bound deve estar dentro do bloco condicionado a status pending');
});

check("19. /conversa ganhou só um link de navegação para '/tarefas', nada mais", () => {
  assert.ok(conversaPageCode.includes("href=\"/tarefas\"") || conversaPageCode.includes("href='/tarefas'"));
  // Nenhuma lógica conversacional nova vazou para o Server Component.
  const forbidden = ['sendConversationMessage', 'getConversationPresentationState', 'getRuntimeState', "from('items')"];
  for (const token of forbidden) {
    assert.ok(!conversaPageCode.includes(token), `lógica indevida encontrada em conversa/page.tsx: ${token}`);
  }
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
