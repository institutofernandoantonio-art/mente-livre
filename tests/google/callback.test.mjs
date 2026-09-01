// Auditoria estática de src/app/conectar-google-calendar/callback/route.ts
// — correção de reconexão via RPC. Desde a Subfase 10 (gate seguro para
// conexões antigas freebusy-only), a RPC chamada por este callback é
// `reconnect_google_calendar_with_event_write` (private/public, migration
// 20260901130000) — NUNCA mais `reconnect_google_calendar` (a RPC antiga,
// migration 20260831020000, permanece intocada só para compatibilidade
// com produção enquanto os novos commits não são deployados; ver
// tests/google/google-calendar-event-write-capability-migration.test.mjs
// para a prova de que ela nunca eleva `event_write_enabled`).
//
// Execução: npm run test:calendar-callback
//
// Por que auditoria estática: o arquivo usa `next/headers`/`next/navigation`
// e `@/lib/supabase/server` — mesmo padrão já usado em toda `src/app/` que
// depende do runtime do Next.js (ver tests/tarefas/tasks-actions.test.mjs).
// O comportamento dinâmico real (a RPC efetivamente evita 23505 e nunca
// expõe o token) é coberto pela auditoria estrutural da migration
// (tests/google/reconnect-migration.test.mjs) + pela garantia do próprio
// Postgres para `ON CONFLICT ... DO UPDATE` — nunca reimplementado aqui.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(
  new URL('../../src/app/conectar-google-calendar/callback/route.ts', import.meta.url),
);
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
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

// ============================================================================
// 1-4. RPC substitui insert/upsert direto — primeira conexão E reconexão
// funcionam, sem tocar a tabela diretamente
// ============================================================================

check(
  "1. usa supabase.rpc('reconnect_google_calendar_with_event_write', ...) — zero insert/upsert direto, NUNCA a RPC antiga",
  () => {
    assert.ok(codeOnly.includes(".rpc('reconnect_google_calendar_with_event_write'"), 'chamada da NOVA RPC não encontrada');
    assert.ok(!codeOnly.includes(".rpc('reconnect_google_calendar'"), 'callback nunca deveria mais chamar a RPC antiga');
    assert.ok(!codeOnly.includes('.insert('), 'insert direto não deveria mais existir neste arquivo');
    assert.ok(!codeOnly.includes('.upsert('), 'upsert direto não deveria mais existir neste arquivo');
  },
);

check('2. zero .from(\'google_calendar_connections\') — este arquivo não toca mais a tabela diretamente', () => {
  assert.ok(!codeOnly.includes("from('google_calendar_connections')"));
});

check(
  '3. payload da RPC contém EXATAMENTE p_refresh_token — user_id/scope/boolean nunca são enviados pelo client',
  () => {
    const match = codeOnly.match(/\.rpc\('reconnect_google_calendar_with_event_write',\s*\{([^}]*)\}/s);
    assert.ok(match, 'payload da RPC não encontrado');
    const payload = match[1];
    assert.ok(payload.includes('p_refresh_token: refreshToken'));
    assert.ok(!/user_id|userId/.test(payload), 'user_id nunca deve ser enviado como parâmetro da RPC');
    assert.ok(!/scope|event_write_enabled|true|false/.test(payload), '25. nenhuma flag booleana/scope deveria vir do browser como parâmetro');
    const keys = payload.match(/(\w+):/g) ?? [];
    assert.equal(keys.length, 1, 'payload deve ter exatamente 1 chave (p_refresh_token)');
  },
);

check('4. exatamente 1 chamada .rpc( em todo o arquivo (zero segunda query)', () => {
  const occurrences = codeOnly.split('.rpc(').length - 1;
  assert.equal(occurrences, 1);
});

// ============================================================================
// 5-6. Zero admin/service-role introduzido; zero delete
// ============================================================================

check('5. continua usando createClient() normal — zero admin/service_role/createAdminClient', () => {
  assert.ok(codeOnly.includes("from '@/lib/supabase/server'"));
  assert.ok(codeOnly.includes('await createClient()'));
  const forbidden = ['createAdminClient', 'service_role', 'SUPABASE_SECRET_KEY', 'admin'];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('6. zero .delete( encadeado em .from( — nada na tabela é apagado por este arquivo', () => {
  // `.delete(` sozinho daria falso positivo em `cookieStore.delete(...)`
  // (exclusão do cookie de state, sempre existiu, nada a ver com banco) —
  // a checagem real é especificamente por um DELETE do Supabase.
  assert.ok(!/\.from\([^)]*\)\s*\.delete\(/.test(codeOnly));
});

// ============================================================================
// 7-9. Mecânica OAuth/CSRF/redirect_uri preservada, intocada por esta correção
// ============================================================================

check('7. validação de code/state/storedState continua idêntica', () => {
  assert.ok(codeOnly.includes('!code || !state || !storedState || state !== storedState'));
});

check('8. redirect_uri continua derivado de url.origin (nunca hardcoded)', () => {
  assert.ok(codeOnly.includes('const redirectUri = `${url.origin}/conectar-google-calendar/callback`'));
});

check(
  '9. resultado final: ?calendar=connected (sucesso) / ?calendar=error (falha técnica) / ?calendar=permissions (consentimento incompleto, Subfase 7) — nenhum quarto destino',
  () => {
    assert.ok(codeOnly.includes("redirect('/entrada?calendar=connected')"));
    const errorOccurrences = codeOnly.split("redirect('/entrada?calendar=error')").length - 1;
    assert.ok(errorOccurrences >= 1);
    const permissionsOccurrences = codeOnly.split("redirect('/entrada?calendar=permissions')").length - 1;
    assert.equal(permissionsOccurrences, 2, 'esperava exatamente 2 pontos de redirect para calendar=permissions (scope ausente/malformado e scope incompleto)');
    // Todo redirect() do arquivo é para um destino literal conhecido —
    // nenhum quarto valor de calendar= foi introduzido.
    const allRedirectTargets = [...codeOnly.matchAll(/redirect\('([^']+)'\)/g)].map((m) => m[1]);
    const allowedTargets = new Set(['/entrada?calendar=error', '/entrada?calendar=connected', '/entrada?calendar=permissions']);
    for (const target of allRedirectTargets) {
      assert.ok(allowedTargets.has(target), `destino de redirect inesperado: ${target}`);
    }
  },
);

// ============================================================================
// 10-14. Consentimento parcial (Subfase 7) — a RPC só é chamada DEPOIS de
// TODAS as validações (refresh_token presente + todos os escopos
// obrigatórios concedidos); qualquer falha nessas validações nunca toca a
// conexão existente, porque a RPC simplesmente não é alcançada.
// ============================================================================

check('10, 11 e 12. nova RPC só é alcançável DEPOIS da validação de refresh_token E de scope — nunca antes', () => {
  const rpcIndex = codeOnly.indexOf(".rpc('reconnect_google_calendar_with_event_write'");
  assert.ok(rpcIndex !== -1, 'chamada da nova RPC não encontrada');

  const refreshTokenCheckIndex = codeOnly.indexOf("typeof refreshToken !== 'string'");
  assert.ok(refreshTokenCheckIndex !== -1, 'checagem de refresh_token não encontrada');
  assert.ok(refreshTokenCheckIndex < rpcIndex, 'checagem de refresh_token deveria vir ANTES da chamada RPC');

  const scopeFieldCheckIndex = codeOnly.indexOf("typeof grantedScopeField !== 'string'");
  assert.ok(scopeFieldCheckIndex !== -1, 'checagem do campo scope não encontrada');
  assert.ok(scopeFieldCheckIndex > refreshTokenCheckIndex, 'checagem de scope deveria vir DEPOIS da checagem de refresh_token');
  assert.ok(scopeFieldCheckIndex < rpcIndex, 'checagem do campo scope deveria vir ANTES da chamada RPC');

  const requiredScopesCheckIndex = codeOnly.indexOf('hasAllRequiredScopes');
  assert.ok(requiredScopesCheckIndex !== -1, 'checagem de escopos obrigatórios não encontrada');
  assert.ok(requiredScopesCheckIndex < rpcIndex, 'checagem de escopos obrigatórios deveria vir ANTES da chamada RPC');
});

check('13. scope obrigatório ausente redireciona para calendar=permissions ANTES de tocar a RPC (nunca altera a conexão existente)', () => {
  const hasAllScopesBlock = codeOnly.match(/if \(!hasAllRequiredScopes\) \{([\s\S]*?)\}/);
  assert.ok(hasAllScopesBlock, 'branch de escopo insuficiente não encontrado');
  assert.ok(hasAllScopesBlock[1].includes("redirect('/entrada?calendar=permissions')"));
  assert.ok(!hasAllScopesBlock[1].includes('.rpc('), 'branch de escopo insuficiente nunca deveria chamar a RPC');
});

// ============================================================================
// 20-24. Todo caminho de falha ANTERIOR à nova RPC (code/state ausentes,
// sessão ausente, config de ambiente ausente, falha de rede na troca,
// resposta não-ok, JSON inválido, scope ausente/malformado) redireciona
// SEM jamais alcançar a chamada da RPC — zero RPC nesses caminhos. E os
// dois desfechos da própria chamada (falha/sucesso) redirecionam para o
// destino correto.
// ============================================================================

check(
  '20, 21 e 22. TODO redirect(...) que aparece ANTES da nova RPC no código-fonte está fora de qualquer bloco que contenha `.rpc(` — nenhum desses caminhos chama a RPC',
  () => {
    const rpcIndex = codeOnly.indexOf(".rpc('reconnect_google_calendar_with_event_write'");
    assert.ok(rpcIndex !== -1);
    const codeBeforeRpc = codeOnly.slice(0, rpcIndex);
    assert.ok(!codeBeforeRpc.includes('.rpc('), 'nenhuma chamada de RPC deveria existir antes da nova RPC no código-fonte');
    // Confirma que existem MÚLTIPLOS pontos de redirect('/entrada?calendar=error')
    // antes da RPC (code/state, sessão, env vars, falha de rede, !ok, JSON
    // inválido, refresh_token ausente) — cada um delimitando um "return"
    // efetivo (redirect() lança) sem jamais alcançar a RPC.
    const earlyErrorRedirects = (codeBeforeRpc.match(/redirect\('\/entrada\?calendar=error'\)/g) ?? []).length;
    assert.ok(earlyErrorRedirects >= 5, `esperava vários pontos de saída antecipada antes da RPC, encontrado: ${earlyErrorRedirects}`);
  },
);

check('23. falha da nova RPC -> calendar=error', () => {
  const rpcErrorBlock = codeOnly.match(/if \(rpcError\) \{([\s\S]*?)\}/);
  assert.ok(rpcErrorBlock, 'branch de falha da RPC não encontrado');
  assert.ok(rpcErrorBlock[1].includes("redirect('/entrada?calendar=error')"));
});

check('24. sucesso da nova RPC -> calendar=connected (último redirect do arquivo, logo após a chamada da RPC)', () => {
  const rpcIndex = codeOnly.indexOf(".rpc('reconnect_google_calendar_with_event_write'");
  const connectedIndex = codeOnly.indexOf("redirect('/entrada?calendar=connected')");
  assert.ok(rpcIndex !== -1 && connectedIndex !== -1);
  assert.ok(connectedIndex > rpcIndex, 'calendar=connected deveria vir depois da chamada da RPC');
});

check('14. todos os escopos concedidos -> grantedScopes.has() confere CADA escopo de GOOGLE_CALENDAR_REQUIRED_SCOPES antes de prosseguir para a RPC', () => {
  assert.ok(codeOnly.includes('GOOGLE_CALENDAR_REQUIRED_SCOPES.every((scope) => grantedScopes.has(scope))'));
});

// ============================================================================
// 15-18. Segurança — zero token exposto (query string, UI, log), zero
// corpo bruto do Google propagado
// ============================================================================

check('15 e 16. nenhum redirect() carrega token/scope na query string — todo destino é um literal fixo /entrada?calendar=...', () => {
  const allRedirectTargets = [...codeOnly.matchAll(/redirect\(([^)]+)\)/g)].map((m) => m[1]);
  for (const target of allRedirectTargets) {
    assert.ok(/^'\/entrada\?calendar=(connected|error|permissions)'$/.test(target.trim()), `redirect com argumento não-literal ou suspeito: ${target}`);
  }
});

check('17. nenhum console.log/error/warn em todo o arquivo (zero risco de logar token/scope)', () => {
  assert.ok(!codeOnly.includes('console.'));
});

check('18. tokenPayload bruto nunca é passado adiante — só usado via type-guard + acesso de propriedade, nunca repassado inteiro', () => {
  // `tokenPayload` só deveria aparecer: na declaração, na atribuição
  // (`= await tokenResponse.json()`), e dentro dos dois blocos de
  // extração (`typeof tokenPayload === 'object' && ... && 'x' in
  // tokenPayload ? (tokenPayload as {...}).x : undefined`) — nunca como
  // argumento solto de redirect()/console/JSON.stringify/qualquer função,
  // e nunca devolvido diretamente.
  assert.ok(!/redirect\([^)]*tokenPayload/.test(codeOnly), 'tokenPayload nunca deveria ir para redirect()');
  assert.ok(!/console\.[a-z]+\([^)]*tokenPayload/.test(codeOnly), 'tokenPayload nunca deveria ser logado');
  assert.ok(!/JSON\.stringify\([^)]*tokenPayload/.test(codeOnly), 'tokenPayload nunca deveria ser serializado de volta');
  assert.ok(!/return\s+tokenPayload/.test(codeOnly), 'tokenPayload nunca deveria ser retornado diretamente');
  // Toda ocorrência restante precisa estar dentro de uma checagem
  // `typeof tokenPayload`/`tokenPayload !==`/`in tokenPayload`/
  // `(tokenPayload as` ou na atribuição/declaração original — nunca solto.
  const allowedContexts = [
    'let tokenPayload: unknown;',
    'tokenPayload = await tokenResponse.json();',
    "typeof tokenPayload === 'object' && tokenPayload !== null && 'refresh_token' in tokenPayload",
    '(tokenPayload as { refresh_token?: unknown }).refresh_token',
    "typeof tokenPayload === 'object' && tokenPayload !== null && 'scope' in tokenPayload",
    '(tokenPayload as { scope?: unknown }).scope',
  ];
  let remaining = codeOnly;
  for (const context of allowedContexts) {
    assert.ok(remaining.includes(context), `contexto esperado não encontrado: ${context}`);
    remaining = remaining.replace(context, '');
  }
  assert.ok(!remaining.includes('tokenPayload'), 'ocorrência inesperada de tokenPayload fora dos contextos permitidos');
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
