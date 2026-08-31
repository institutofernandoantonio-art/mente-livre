// Auditoria estática de navegação da V1 — prova, por leitura do
// código-fonte real (sem renderer de React, mesmo padrão já usado por
// tarefas.test.mjs), que o fluxo funcional principal é alcançável só com
// os links visíveis do produto:
//
//   / → /conversa → /tarefas → (voltar) → /conversa
//                 ↖ /entrada ↗ (acesso secundário nos dois sentidos)
//
// Execução: node tests/navigation/navigation.test.mjs (sem flags — nenhum
// import de módulo .ts é feito aqui, só leitura de texto).

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function readCodeOnly(relativePath) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = readFileSync(path, 'utf8');
  return source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function byteDiffIsEmpty(relativePathFromRoot) {
  return execSync(`git diff -- ${relativePathFromRoot}`, { cwd: repoRoot }).toString().trim();
}

// Lista os arquivos com diff (modificados OU novos/untracked) dentro de um
// diretório — usado para permitir uma LISTA EXATA de arquivos autorizados
// a mudar num diretório, em vez de exigir zero diff no diretório inteiro
// (que ficaria obsoleto assim que qualquer subfase futura, legitimamente
// autorizada, precisasse tocar algo ali — ver teste 13).
function changedFilesUnder(relativePathFromRoot) {
  const output = execSync(`git status --porcelain --untracked-files=all -- ${relativePathFromRoot}`, {
    cwd: repoRoot,
  }).toString();
  return output
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim());
}

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

const homeCode = readCodeOnly('../../src/app/page.tsx');
const entradaCode = readCodeOnly('../../src/app/entrada/page.tsx');
const conversaCode = readCodeOnly('../../src/app/conversa/page.tsx');
const tarefasCode = readCodeOnly('../../src/app/tarefas/page.tsx');
const panelCode = readCodeOnly('../../src/app/conversa/ConversationPanel.tsx');

// ============================================================================
// 1-2. HOME — CTA principal para /conversa + acesso secundário a /entrada
// ============================================================================

check('1. CTA principal de / aponta para /conversa (nunca mais para /entrada)', () => {
  const primaryMatch = homeCode.match(/<Link href="\/conversa" className=\{buttonVariants\("primary"[^}]*\)\}>/);
  assert.ok(primaryMatch, 'CTA primária apontando para /conversa não encontrada');
});

check('2. home mantém acesso secundário (ghost) para /entrada, sem novo componente', () => {
  assert.ok(homeCode.includes('href="/entrada"'), 'link para /entrada ausente na home');
  assert.ok(
    /<Link href="\/entrada" className=\{buttonVariants\("ghost"\)\}>/.test(homeCode),
    'link para /entrada deve usar buttonVariants("ghost") já existente, nenhum componente novo',
  );
  // Nenhum import novo de componente de navegação (Navbar/Sidebar/Menu).
  const forbiddenImports = ['Navbar', 'Sidebar', 'BottomNavigation', 'Menu'];
  for (const token of forbiddenImports) {
    assert.ok(!homeCode.includes(token), `componente de navegação global indevido: ${token}`);
  }
});

check('3. home preserva BrainMark/LogoMark/título/tagline (identidade visual intacta)', () => {
  assert.ok(homeCode.includes('<BrainMark'));
  assert.ok(homeCode.includes('<LogoMark'));
  assert.ok(homeCode.includes('Mente'));
  assert.ok(homeCode.includes('Livre'));
});

// ============================================================================
// 4. /entrada — ganhou acesso para /conversa, sem tocar lógica existente
// ============================================================================

check('4. /entrada possui link visível para /conversa', () => {
  assert.ok(
    /<Link href="\/conversa" className=\{buttonVariants\("secondary"\)\}>/.test(entradaCode),
    'link para /conversa não encontrado em /entrada',
  );
});

check('5. /entrada preserva BrainDumpForm, Calendar, MFA e logout inalterados nesta subfase', () => {
  assert.ok(entradaCode.includes('<BrainDumpForm'));
  assert.ok(entradaCode.includes('connectGoogleCalendar'));
  assert.ok(entradaCode.includes("href=\"/mfa/configurar\""));
  assert.ok(entradaCode.includes('logout'));
  // Mudança desta subfase é só navegação — zero lógica nova de domínio.
  const forbiddenNewLogic = ['.from(', '.insert(', '.update(', '.delete(', 'createBrainDump', 'organizeBrainDump'];
  for (const token of forbiddenNewLogic) {
    assert.ok(!entradaCode.includes(token), `lógica de domínio indevida em page.tsx: ${token}`);
  }
});

// ============================================================================
// 6-7. /conversa e /tarefas — navegação existente preservada, arquivos
// byte-a-byte intocados nesta subfase (a instrução não pede nenhuma mudança
// nelas — só confirmação de que continuam como estavam).
// ============================================================================

check('6. /conversa continua com acesso para /tarefas e para /entrada', () => {
  assert.ok(conversaCode.includes('href="/tarefas"') || conversaCode.includes("href='/tarefas'"));
  assert.ok(conversaCode.includes('href="/entrada"') || conversaCode.includes("href='/entrada'"));
});

check('7. conversa/page.tsx não foi alterado nesta subfase (byte-for-byte)', () => {
  const diff = byteDiffIsEmpty('src/app/conversa/page.tsx');
  assert.equal(diff, '', 'src/app/conversa/page.tsx foi modificado — esperado zero diff');
});

check('8. /tarefas continua com acesso para /conversa', () => {
  assert.ok(tarefasCode.includes('href="/conversa"') || tarefasCode.includes("href='/conversa'"));
});

check('9. tarefas/page.tsx não foi alterado nesta subfase (byte-for-byte)', () => {
  const diff = byteDiffIsEmpty('src/app/tarefas/page.tsx');
  assert.equal(diff, '', 'src/app/tarefas/page.tsx foi modificado — esperado zero diff');
});

// ============================================================================
// 10-13. Componentes/lógica que esta subfase NUNCA deveria tocar
// ============================================================================

// Nota histórica: a versão anterior deste teste exigia zero diff em
// ConversationPanel.tsx — válido enquanto nenhuma subfase posterior tinha
// motivo legítimo para tocá-lo. A subfase de query_calendar read-only
// autoriza explicitamente uma única mudança nele (captura/envio do
// timezone do browser); a asserção de "byte-for-byte" ficou obsoleta por
// isso, não por regressão real. Reescrita para permitir EXATAMENTE essa
// mudança, continuando a proibir tudo o que sempre foi proibido.
check(
  '10. ConversationPanel.tsx: única mudança permitida é a captura/envio de timezone — zero lógica Calendar/Supabase/token/localStorage, zero componente novo',
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
    // "Calendar" (substantivo) continua ausente do código real — só a
    // string literal 'timezone'/Intl, nunca um import/lógica de Calendar.
    assert.ok(!panelCode.includes('Calendar'), 'nenhum import/lógica de Calendar deveria existir no client');

    // Nenhum componente novo — mesmas 3 funções de nível superior de sempre.
    const topLevelFunctions = [...panelCode.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(
      topLevelFunctions.sort(),
      ['MessageBubble', 'ProposalPreview', 'nextId'].sort(),
      'nenhuma função de nível superior nova deveria existir além das 3 já aprovadas',
    );
  },
);

check('11. BrainDumpForm.tsx não foi alterado nesta subfase (byte-for-byte)', () => {
  const diff = byteDiffIsEmpty('src/app/entrada/BrainDumpForm.tsx');
  assert.equal(diff, '', 'BrainDumpForm.tsx foi modificado — esperado zero diff');
});

check('12. src/lib/supabase/actions.ts (createBrainDump/organizeBrainDump) intacto', () => {
  const diff = byteDiffIsEmpty('src/lib/supabase/actions.ts');
  assert.equal(diff, '', 'src/lib/supabase/actions.ts foi modificado — esperado zero diff');
});

// Nota histórica: a versão anterior deste teste exigia zero diff em todo
// `src/lib/conversation/` — válido enquanto nenhuma subfase posterior
// tinha motivo legítimo para tocar o NLU/pipeline. A subfase de
// query_calendar read-only autoriza explicitamente 5 arquivos ali (o
// desvio de query_calendar para fora de ProposedAction); a asserção de
// "diretório inteiro intacto" ficou obsoleta por isso, não por vazamento
// de escopo real. Reescrita para permitir EXATAMENTE esses 5 arquivos,
// continuando a proibir qualquer outro módulo conversacional inesperado.
check(
  '13. src/lib/conversation/: só os 5 arquivos autorizados desta subfase têm diff — nenhum outro módulo conversacional tocado',
  () => {
    const allowed = new Set([
      'src/lib/conversation/actions.ts',
      'src/lib/conversation/conversation-entry.ts',
      'src/lib/conversation/conversation-turn.ts',
      'src/lib/conversation/presentation-ui.ts',
      'src/lib/conversation/calendar-query.ts',
    ]);
    const changed = changedFilesUnder('src/lib/conversation/');
    for (const file of changed) {
      assert.ok(allowed.has(file), `arquivo não autorizado com diff em src/lib/conversation/: ${file}`);
    }
  },
);

check('14. src/lib/google/ (Calendar) inteiramente intacto', () => {
  const diff = byteDiffIsEmpty('src/lib/google/');
  assert.equal(diff, '', 'src/lib/google/ foi modificado — esperado zero diff');
});

check('15. src/app/layout.tsx intacto — nenhuma navbar/sidebar global criada', () => {
  const diff = byteDiffIsEmpty('src/app/layout.tsx');
  assert.equal(diff, '', 'src/app/layout.tsx foi modificado — esperado zero diff');
});

check('16. src/app/tarefas/actions.ts (Server Action de concluir) intacto — zero Server Action nova', () => {
  const diff = byteDiffIsEmpty('src/app/tarefas/actions.ts');
  assert.equal(diff, '', 'src/app/tarefas/actions.ts foi modificado — esperado zero diff');
});

// ============================================================================
// 17-18. Nenhuma rota removida + grafo de navegação alcançável sem URL
// digitada manualmente
// ============================================================================

check('17. nenhuma rota removida — os 4 arquivos de página continuam existindo e exportando default', () => {
  for (const rel of [
    'src/app/page.tsx',
    'src/app/entrada/page.tsx',
    'src/app/conversa/page.tsx',
    'src/app/tarefas/page.tsx',
  ]) {
    const abs = fileURLToPath(new URL(`../../${rel}`, import.meta.url));
    assert.ok(existsSync(abs), `rota removida: ${rel}`);
    const code = readFileSync(abs, 'utf8');
    assert.ok(/export default (async )?function/.test(code), `${rel} não exporta mais um default function`);
  }
});

check(
  '18. grafo de navegação: / → /conversa, /entrada → /conversa, /conversa → /tarefas, /tarefas → /conversa — todos alcançáveis só por link, nenhum exige URL digitada',
  () => {
    assert.ok(homeCode.includes('href="/conversa"'), '/ não linka para /conversa');
    assert.ok(entradaCode.includes('href="/conversa"'), '/entrada não linka para /conversa');
    assert.ok(
      conversaCode.includes('href="/tarefas"') || conversaCode.includes("href='/tarefas'"),
      '/conversa não linka para /tarefas',
    );
    assert.ok(
      tarefasCode.includes('href="/conversa"') || tarefasCode.includes("href='/conversa'"),
      '/tarefas não linka para /conversa',
    );
  },
);

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
