import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const actions = readFileSync(
  fileURLToPath(new URL('../../src/app/resumo/actions.ts', import.meta.url)),
  'utf8',
);
const client = readFileSync(
  fileURLToPath(new URL('../../src/app/resumo/TodaySummary.tsx', import.meta.url)),
  'utf8',
);
const page = readFileSync(
  fileURLToPath(new URL('../../src/app/resumo/page.tsx', import.meta.url)),
  'utf8',
);
const proxy = readFileSync(
  fileURLToPath(new URL('../../src/proxy.ts', import.meta.url)),
  'utf8',
);
const hoje = readFileSync(
  fileURLToPath(new URL('../../src/app/hoje/page.tsx', import.meta.url)),
  'utf8',
);

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

check('resumo usa o módulo central de timezone e valida o fuso recebido', () => {
  assert.ok(actions.includes("from '@/lib/conversation/timezone'"));
  assert.ok(actions.includes('isValidTimeZone(timeZone)'));
  assert.ok(actions.includes('getCivilDateInTimeZone(now, timeZone)'));
  assert.ok(actions.includes('addCivilDays(today, 1)'));
  assert.ok(actions.includes('resolveCivilDateTimeInTimeZone'));
});

check('consulta é isolada por usuário e só inclui tarefas concluídas confirmadas', () => {
  assert.ok(actions.includes('supabase.auth.getClaims()'));
  assert.ok(actions.includes(".eq('user_id', userId)"));
  assert.ok(actions.includes(".eq('status', 'completed')"));
  assert.ok(actions.includes(".eq('needs_confirmation', false)"));
  assert.ok(actions.includes(".gte('completed_at'"));
  assert.ok(actions.includes(".lt('completed_at'"));
  assert.ok(!actions.includes('createAdminClient'));
  assert.ok(!actions.includes('service_role'));
});

check('resumo limita detalhes a 10 itens e mantém contagem exata', () => {
  assert.ok(actions.includes("{ count: 'exact' }"));
  assert.ok(actions.includes('.limit(10)'));
  assert.ok(client.includes('Mostrando as 10 conclusões mais recentes.'));
});

check('fuso vem do aparelho e não é persistido', () => {
  assert.ok(client.includes('Intl.DateTimeFormat().resolvedOptions().timeZone'));
  assert.ok(!actions.includes(".from('profiles')"));
  assert.ok(!actions.includes('.update('));
  assert.ok(!actions.includes('.insert('));
});

check('rota de resumo está protegida e navegável a partir de Hoje', () => {
  assert.ok(proxy.includes("'/resumo'"));
  assert.ok(hoje.includes('href="/resumo"'));
  assert.ok(page.includes('Voltar para Hoje'));
});

const passed = checks.filter(Boolean).length;
const failed = checks.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${checks.length} total)`);
if (failed > 0) process.exit(1);
