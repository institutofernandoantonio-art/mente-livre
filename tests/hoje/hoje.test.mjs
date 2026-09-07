import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const hojePath = fileURLToPath(new URL('../../src/app/hoje/page.tsx', import.meta.url));
const conversaPath = fileURLToPath(new URL('../../src/app/conversa/page.tsx', import.meta.url));
const tarefasPath = fileURLToPath(new URL('../../src/app/tarefas/page.tsx', import.meta.url));
const proxyPath = fileURLToPath(new URL('../../src/proxy.ts', import.meta.url));

const hoje = readFileSync(hojePath, 'utf8');
const conversa = readFileSync(conversaPath, 'utf8');
const tarefas = readFileSync(tarefasPath, 'utf8');
const proxy = readFileSync(proxyPath, 'utf8');

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push(true);
    console.log(`[PASS] ${name}`);
  } catch (error) {
    checks.push(false);
    console.log(`[FAIL] ${name} — ${error.message}`);
  }
}

check('Hoje lê somente tarefas confirmadas e pendentes do usuário autenticado', () => {
  assert.ok(hoje.includes('getClaims()'));
  assert.ok(hoje.includes(".eq('user_id', userId)"));
  assert.ok(hoje.includes(".eq('status', 'pending')"));
  assert.ok(hoje.includes(".eq('needs_confirmation', false)"));
  assert.ok(!hoje.includes('createAdminClient'));
  assert.ok(!hoje.includes('service_role'));
});

check('Hoje usa apenas prioridades explícitas e limita o foco a três itens', () => {
  assert.ok(hoje.includes('task.priority !== null'));
  assert.ok(hoje.includes('.slice(0, 3)'));
  assert.ok(hoje.includes("alta: 0"));
  assert.ok(hoje.includes("média: 1"));
  assert.ok(hoje.includes("baixa: 2"));
});

check('Hoje marca a primeira prioridade como sugestão, não como decisão automática', () => {
  assert.ok(hoje.includes('Missão principal sugerida'));
  assert.ok(!hoje.includes('Missão principal definida'));
});

check('Hoje permite concluir pelo fluxo existente, sem nova mutação', () => {
  assert.ok(hoje.includes("import { completeTaskAction } from '@/app/tarefas/actions'"));
  assert.ok(hoje.includes('completeTaskAction.bind(null, task.id)'));
  assert.ok(!hoje.includes('.update('));
  assert.ok(!hoje.includes('.insert('));
  assert.ok(!hoje.includes('.delete('));
});

check('Hoje mostra próximos compromissos usando a conta da sessão', () => {
  assert.ok(hoje.includes('buildGoogleCalendarAccountUrl(email)'));
  assert.ok(hoje.includes('<UpcomingCalendarEvents calendarUrl={calendarUrl} accountEmail={email} />'));
});

check('Hoje está protegido pelo mesmo gate AAL2 das rotas privadas principais', () => {
  assert.ok(proxy.includes("'/hoje'"));
  assert.ok(proxy.includes('AAL2_REQUIRED_PATHS'));
});

check('Conversa e tarefas oferecem navegação visível para Hoje', () => {
  assert.ok(conversa.includes('href="/hoje"'));
  assert.ok(tarefas.includes('href="/hoje"'));
});

const passed = checks.filter(Boolean).length;
const failed = checks.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${checks.length} total)`);
if (failed > 0) process.exit(1);
