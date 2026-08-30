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

check('10. ConversationPanel.tsx não foi alterado nesta subfase (byte-for-byte)', () => {
  const diff = byteDiffIsEmpty('src/app/conversa/ConversationPanel.tsx');
  assert.equal(diff, '', 'ConversationPanel.tsx foi modificado — esperado zero diff');
});

check('11. BrainDumpForm.tsx não foi alterado nesta subfase (byte-for-byte)', () => {
  const diff = byteDiffIsEmpty('src/app/entrada/BrainDumpForm.tsx');
  assert.equal(diff, '', 'BrainDumpForm.tsx foi modificado — esperado zero diff');
});

check('12. src/lib/supabase/actions.ts (createBrainDump/organizeBrainDump) intacto', () => {
  const diff = byteDiffIsEmpty('src/lib/supabase/actions.ts');
  assert.equal(diff, '', 'src/lib/supabase/actions.ts foi modificado — esperado zero diff');
});

check('13. src/lib/conversation/ (NLU/pipeline) inteiramente intacto', () => {
  const diff = byteDiffIsEmpty('src/lib/conversation/');
  assert.equal(diff, '', 'src/lib/conversation/ foi modificado — esperado zero diff');
});

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
