import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pagePath = fileURLToPath(new URL('../../src/app/tarefas/page.tsx', import.meta.url));
const pageCode = readFileSync(pagePath, 'utf8');

const results = [];

function check(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
    console.log(`[PASS] ${name}`);
  } catch (error) {
    results.push({ name, pass: false });
    console.log(`[FAIL] ${name} — ${error.message}`);
  }
}

check('1. foco usa somente tarefas já priorizadas e pendentes pela ordem existente', () => {
  assert.ok(pageCode.includes("const focusTasks = tasks.filter((task) => taskOrder(task) < 3).slice(0, 3)"));
});

check('2. foco é limitado a exatamente até 3 itens', () => {
  assert.ok(pageCode.includes('.slice(0, 3)'));
});

check('3. primeiro item é apresentado como sugestão, nunca como decisão persistida do usuário', () => {
  assert.ok(pageCode.includes('Missão principal sugerida'));
  assert.ok(!pageCode.includes('Missão principal definida'));
});

check('4. bloco de foco só aparece quando há prioridade explícita', () => {
  assert.ok(pageCode.includes('focusTasks.length > 0'));
});

check('5. implementação não adiciona persistência nem nova mutação', () => {
  const forbidden = ['focus_task', 'mission_id', '.insert(', '.upsert(', "from('daily", 'localStorage', 'sessionStorage'];
  for (const token of forbidden) {
    assert.ok(!pageCode.includes(token), `persistência/mutação indevida encontrada: ${token}`);
  }
});

check('6. foco não expõe task.id', () => {
  const focusStart = pageCode.indexOf('<ol className="flex flex-col gap-2">');
  const focusEnd = pageCode.indexOf('</ol>', focusStart);
  assert.ok(focusStart !== -1 && focusEnd !== -1);
  const focusBlock = pageCode.slice(focusStart, focusEnd);
  assert.ok(!focusBlock.includes('task.id'));
});

const failed = results.filter((result) => !result.pass).length;
console.log(`\n${results.length - failed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
