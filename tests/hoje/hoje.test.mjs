import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const hojePath = fileURLToPath(new URL('../../src/app/hoje/page.tsx', import.meta.url));
const conversaPath = fileURLToPath(new URL('../../src/app/conversa/page.tsx', import.meta.url));
const tarefasPath = fileURLToPath(new URL('../../src/app/tarefas/page.tsx', import.meta.url));
const proxyPath = fileURLToPath(new URL('../../src/proxy.ts', import.meta.url));
const resumoActionsPath = fileURLToPath(new URL('../../src/app/resumo/actions.ts', import.meta.url));
const resumoClientPath = fileURLToPath(new URL('../../src/app/resumo/TodaySummary.tsx', import.meta.url));
const resumoPagePath = fileURLToPath(new URL('../../src/app/resumo/page.tsx', import.meta.url));

const hoje = readFileSync(hojePath, 'utf8');
const conversa = readFileSync(conversaPath, 'utf8');
const tarefas = readFileSync(tarefasPath, 'utf8');
const proxy = readFileSync(proxyPath, 'utf8');
const resumoActions = readFileSync(resumoActionsPath, 'utf8');
const resumoClient = readFileSync(resumoClientPath, 'utf8');
const resumoPage = readFileSync(resumoPagePath, 'utf8');

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

check('Hoje usa apenas prioridades explícitas e limita o foco a uma missão mais três prioridades', () => {
  assert.ok(hoje.includes('task.priority !== null'));
  assert.ok(hoje.includes('.slice(0, 4)'));
  assert.ok(hoje.includes("alta: 0"));
  assert.ok(hoje.includes("média: 1"));
  assert.ok(hoje.includes("baixa: 2"));
});

check('Hoje numera corretamente as prioridades depois da missão sugerida', () => {
  assert.ok(hoje.includes("index === 0 ? 'Missão principal sugerida' : `Prioridade ${index}`"));
  assert.ok(!hoje.includes('`Prioridade ${index + 1}`'));
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
  assert.ok(hoje.includes('calendarUrl={calendarUrl}'));
  assert.ok(hoje.includes('accountEmail={email}'));
});

check('Hoje conecta somente a missão principal sugerida ao bloco de orientação Agora', () => {
  assert.ok(hoje.includes('const missionTitle = focusTasks[0]?.title ?? null'));
  assert.ok(hoje.includes('focusTitle={missionTitle}'));
  assert.ok(!hoje.includes('anthropic'));
  assert.ok(!hoje.includes('openai'));
});

check('Hoje está protegido pelo mesmo gate AAL2 das rotas privadas principais', () => {
  assert.ok(proxy.includes("'/hoje'"));
  assert.ok(proxy.includes('AAL2_REQUIRED_PATHS'));
});

check('Conversa e tarefas oferecem navegação visível para Hoje', () => {
  assert.ok(conversa.includes('href="/hoje"'));
  assert.ok(tarefas.includes('href="/hoje"'));
});

check('Resumo usa a implementação central de timezone e valida o fuso do aparelho', () => {
  assert.ok(resumoActions.includes("from '@/lib/conversation/timezone'"));
  assert.ok(resumoActions.includes('isValidTimeZone(timeZone)'));
  assert.ok(resumoActions.includes('getCivilDateInTimeZone(now, timeZone)'));
  assert.ok(resumoActions.includes('addCivilDays(today, 1)'));
  assert.ok(resumoActions.includes('resolveCivilDateTimeInTimeZone'));
  assert.ok(resumoClient.includes('Intl.DateTimeFormat().resolvedOptions().timeZone'));
});

check('Resumo lê somente conclusões confirmadas do usuário dentro do dia civil', () => {
  assert.ok(resumoActions.includes('supabase.auth.getClaims()'));
  assert.ok(resumoActions.includes(".eq('user_id', userId)"));
  assert.ok(resumoActions.includes(".eq('status', 'completed')"));
  assert.ok(resumoActions.includes(".eq('needs_confirmation', false)"));
  assert.ok(resumoActions.includes(".gte('completed_at'"));
  assert.ok(resumoActions.includes(".lt('completed_at'"));
  assert.ok(!resumoActions.includes('createAdminClient'));
  assert.ok(!resumoActions.includes('service_role'));
});

check('Resumo é somente leitura, limita detalhes e mantém contagem exata', () => {
  assert.ok(resumoActions.includes("{ count: 'exact' }"));
  assert.ok(resumoActions.includes('.limit(10)'));
  assert.ok(!resumoActions.includes('.update('));
  assert.ok(!resumoActions.includes('.insert('));
  assert.ok(!resumoActions.includes('.delete('));
  assert.ok(resumoClient.includes('Mostrando as 10 conclusões mais recentes.'));
});

check('Resumo está protegido e navegável a partir de Hoje', () => {
  assert.ok(proxy.includes("'/resumo'"));
  assert.ok(hoje.includes('href="/resumo"'));
  assert.ok(resumoPage.includes('Voltar para Hoje'));
});

const passed = checks.filter(Boolean).length;
const failed = checks.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${checks.length} total)`);
if (failed > 0) process.exit(1);
