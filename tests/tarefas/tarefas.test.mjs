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
const entradaPageCode = readCodeOnly('../../src/app/entrada/page.tsx');
const panelCode = readCodeOnly('../../src/app/conversa/ConversationPanel.tsx');

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
  // `task.id` aparece EXATAMENTE 3 vezes em todo o arquivo: key do React,
  // argumento do bind de completeTaskAction, argumento do bind de
  // cancelTaskAction — nunca renderizado como texto visível.
  const occurrences = pageCode.split('task.id').length - 1;
  assert.equal(occurrences, 3, 'task.id deve aparecer exatamente 3 vezes (key + 2 binds de action)');
  assert.ok(pageCode.includes('key={task.id}'));
  assert.ok(pageCode.includes('completeTaskAction.bind(null, task.id)'));
  assert.ok(pageCode.includes('cancelTaskAction.bind(null, task.id)'));
  // Nenhuma das três ocorrências está dentro de um nó de texto renderizado
  // (ex.: `>{task.id}<`) — todas são atributo/argumento, nunca conteúdo.
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

// Nota histórica: a versão anterior deste teste checava a presença do link
// para /conversa via `git diff` das linhas ADICIONADAS em entrada/page.tsx
// — válido só enquanto aquela mudança (subfase de navegação/descoberta da
// V1) ainda estava sem commit. Depois do commit isolado correspondente
// (2bb4cad), `git diff` desse arquivo passa a ser vazio por definição,
// então uma asserção baseada em "linha adicionada no diff atual" fica
// estruturalmente inatingível para sempre — não uma falha de regressão
// real. Reescrito para checar o CONTEÚDO do arquivo (estável
// independentemente do estado do git/commit) em vez do diff — mesma
// correção já aplicada em presentation-ui.test.mjs (teste 26).
check(
  '16. /entrada: BrainDumpForm.tsx byte-for-byte intacto; page.tsx contém o link já commitado para /conversa e a única adição autorizada da Subfase 7 (calendar=permissions)',
  () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));

    const brainDumpDiff = execSync('git diff -- src/app/entrada/BrainDumpForm.tsx', { cwd: root })
      .toString()
      .trim();
    assert.equal(brainDumpDiff, '', 'BrainDumpForm.tsx foi modificado — esperado zero diff');

    // Nota histórica (mesma de presentation-ui.test.mjs, teste 26): este
    // teste antes exigia diff VAZIO em page.tsx. A Subfase 7 (ampliação
    // controlada do OAuth) autoriza explicitamente UMA adição: o
    // parágrafo de `calendar === "permissions"` — checagem de conteúdo
    // estável, nunca depende do arquivo estar ou não commitado.
    const pageDiff = execSync('git diff -- src/app/entrada/page.tsx', { cwd: root }).toString();
    const removedLines = pageDiff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---'));
    assert.equal(removedLines.length, 0, 'nenhuma linha deveria ser REMOVIDA de entrada/page.tsx nesta subfase');
    const addedLines = pageDiff
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1).trim());
    const allowedAddedLines = new Set([
      '',
      '{calendar === "permissions" && (',
      '<p role="alert" className="mb-4 text-center text-sm text-alert-500">',
      'Para agendar compromissos, o Mente Livre precisa da permissão de criar eventos no seu Google Agenda.',
      '</p>',
      ')}',
    ]);
    for (const line of addedLines) {
      assert.ok(allowedAddedLines.has(line), `linha adicionada não autorizada em entrada/page.tsx: ${JSON.stringify(line)}`);
    }

    // O link para /conversa (da subfase de navegação, já commitado em
    // 2bb4cad) continua presente no CONTEÚDO real do arquivo — checagem
    // estável para sempre, nunca depende de o commit estar ou não no
    // working tree.
    assert.ok(
      /<Link href="\/conversa" className=\{buttonVariants\("secondary"\)\}>/.test(entradaPageCode),
      'link para /conversa ausente de entrada/page.tsx',
    );
    assert.ok(
      entradaPageCode.includes('Para agendar compromissos, o Mente Livre precisa da permissão de criar eventos no seu Google Agenda.'),
      'mensagem de permissão incompleta (Subfase 7) ausente de entrada/page.tsx',
    );

    // Nenhuma lógica de BrainDump/Calendar/MFA/logout foi alterada.
    const forbidden = ['.from(', '.insert(', '.update(', '.delete(', 'createBrainDump', 'organizeBrainDump'];
    for (const token of forbidden) {
      assert.ok(!entradaPageCode.includes(token), `lógica indevida encontrada em entrada/page.tsx: ${token}`);
    }
    // Lógica existente (BrainDump/Calendar/MFA/logout) continua presente.
    assert.ok(entradaPageCode.includes('<BrainDumpForm'));
    assert.ok(entradaPageCode.includes('connectGoogleCalendar'));
    assert.ok(entradaPageCode.includes('href="/mfa/configurar"'));
    assert.ok(entradaPageCode.includes('logout'));
  },
);

// Nota histórica: a versão anterior deste teste exigia zero diff em
// ConversationPanel.tsx — válido enquanto nenhuma subfase posterior tinha
// motivo legítimo para tocá-lo. A subfase de query_calendar read-only
// autoriza explicitamente uma única mudança nele (captura/envio do
// timezone do browser); a asserção de "byte-for-byte" ficou obsoleta por
// isso, não por regressão real. Reescrita para permitir EXATAMENTE essa
// mudança — mesma correção já aplicada em navigation.test.mjs (teste 10).
check(
  '17. ConversationPanel.tsx: única mudança permitida é a captura/envio de timezone — zero lógica Calendar/Supabase/token/localStorage, zero componente novo',
  () => {
    assert.ok(
      panelCode.includes('Intl.DateTimeFormat().resolvedOptions().timeZone'),
      'captura de timezone não encontrada',
    );
    assert.ok(
      /sendConversationMessage\(\s*text\s*,\s*timezone\s*\)/.test(panelCode),
      'timezone não está sendo enviado como 2º argumento de sendConversationMessage',
    );

    const forbidden = [
      'supabase',
      'Supabase',
      'createAdminClient',
      'service_role',
      'getGoogleCalendarBusyTimes',
      'calendar-query',
      "from '@/lib/google",
      'access_token',
      'refresh_token',
      'GOOGLE_CLIENT',
      'localStorage',
      'sessionStorage',
      'document.cookie',
      'createContext',
      'useContext',
    ];
    for (const token of forbidden) {
      assert.ok(!panelCode.includes(token), `token proibido encontrado: ${token}`);
    }
    assert.ok(!panelCode.includes('Calendar'), 'nenhum import/lógica de Calendar deveria existir no client');

    const topLevelFunctions = [...panelCode.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(
      topLevelFunctions.sort(),
      ['MessageBubble', 'ProposalPreview', 'nextId'].sort(),
      'nenhuma função de nível superior nova deveria existir além das 3 já aprovadas',
    );
  },
);

check('18b. página importa completeTaskAction/cancelTaskAction de ./actions, nunca implementa mutação própria', () => {
  assert.ok(pageCode.includes("from './actions'"));
  assert.ok(pageCode.includes('completeTaskAction'));
  assert.ok(pageCode.includes('cancelTaskAction'));
  // page.tsx nunca chama .update/.delete/.upsert/.rpc diretamente — a
  // única mutação da rota vive inteiramente em actions.ts (teste 11 já
  // confirma zero mutação em page.tsx). Ambos os wrappers precisam ser
  // importados de `./actions` (não definidos localmente) porque só uma
  // função exportada de um módulo `'use server'` pode ser passada como
  // `action` de um `<form>` — uma função comum declarada dentro do
  // próprio Server Component é rejeitada pelo React nesse ponto
  // específico (erro real reproduzido no teste manual da subfase de
  // conclusão de tarefa).
  assert.ok(!/function completeTaskAction/.test(pageCode), 'completeTaskAction não deve ser definido em page.tsx');
  assert.ok(!/function cancelTaskAction/.test(pageCode), 'cancelTaskAction não deve ser definido em page.tsx');
});

check(
  '18c. botões "Concluir"/"Cancelar" só aparecem para task.status === \'pending\' (completed/cancelled não têm nenhum botão)',
  () => {
    assert.ok(pageCode.includes("task.status === 'pending'"));
    // Só 1 ocorrência da condição — os dois forms (Concluir/Cancelar)
    // compartilham o MESMO bloco condicional, nunca duas checagens
    // independentes que poderiam divergir.
    const occurrences = pageCode.split("task.status === 'pending'").length - 1;
    assert.equal(occurrences, 1, "task.status === 'pending' deve aparecer exatamente 1 vez");

    const conditionIndex = pageCode.indexOf("task.status === 'pending'");
    const completeFormIndex = pageCode.indexOf('completeTaskAction.bind(null, task.id)');
    const cancelFormIndex = pageCode.indexOf('cancelTaskAction.bind(null, task.id)');
    assert.ok(conditionIndex !== -1 && completeFormIndex !== -1 && cancelFormIndex !== -1);
    assert.ok(conditionIndex < completeFormIndex, 'form de Concluir deve estar dentro do bloco condicionado a pending');
    assert.ok(conditionIndex < cancelFormIndex, 'form de Cancelar deve estar dentro do bloco condicionado a pending');
  },
);

check('18d. botão "Cancelar" usa variant ghost (visualmente secundário/discreto, sem redesign)', () => {
  assert.ok(/variant="ghost">\s*Cancelar/.test(pageCode), 'botão Cancelar deve usar variant="ghost"');
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
