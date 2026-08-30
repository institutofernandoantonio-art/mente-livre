// Testes unitários de src/lib/conversation/conversation-ttl.ts.
//
// Execução: npm run test:conversation-ttl
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão de
// tests/conversation/confirmation.test.mjs/runtime-state-validation.test.mjs.
// Módulo 100% puro (zero import de valor, zero `server-only`) — importa o
// arquivo real diretamente, sem loader/redirect.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLARIFICATION_TTL_MS,
  PROPOSAL_TTL_MS,
  getClarificationExpiresAt,
  getProposalExpiresAt,
} from '../../src/lib/conversation/conversation-ttl.ts';

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
// 1-2. CONSTANTES
// ============================================================================

check('1. CLARIFICATION_TTL_MS representa exatamente 24 horas', () => {
  assert.equal(CLARIFICATION_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(CLARIFICATION_TTL_MS, 86_400_000);
});

check('2. PROPOSAL_TTL_MS representa exatamente 30 minutos', () => {
  assert.equal(PROPOSAL_TTL_MS, 30 * 60 * 1000);
  assert.equal(PROPOSAL_TTL_MS, 1_800_000);
});

// ============================================================================
// 3-4. CÁLCULO EXATO
// ============================================================================

check('3. getClarificationExpiresAt(now) retorna exatamente now + 24h', () => {
  const now = 1_700_000_000_000;
  assert.equal(getClarificationExpiresAt(now), now + CLARIFICATION_TTL_MS);
});

check('4. getProposalExpiresAt(now) retorna exatamente now + 30min', () => {
  const now = 1_700_000_000_000;
  assert.equal(getProposalExpiresAt(now), now + PROPOSAL_TTL_MS);
});

// ============================================================================
// 5-6. VALORES DE `now`
// ============================================================================

check('5. now = 0 funciona deterministicamente', () => {
  assert.equal(getClarificationExpiresAt(0), CLARIFICATION_TTL_MS);
  assert.equal(getProposalExpiresAt(0), PROPOSAL_TTL_MS);
});

check('6. now fixo realista (epoch ms atual) funciona', () => {
  const now = 1_772_000_000_000; // instante fixo, arbitrário, realista
  assert.equal(getClarificationExpiresAt(now), now + 86_400_000);
  assert.equal(getProposalExpiresAt(now), now + 1_800_000);
});

// ============================================================================
// 7-10. `now` INVÁLIDO -> TypeError
// ============================================================================

check('7. now = NaN é rejeitado (TypeError)', () => {
  assert.throws(() => getClarificationExpiresAt(NaN), TypeError);
  assert.throws(() => getProposalExpiresAt(NaN), TypeError);
});

check('8. now = Infinity é rejeitado (TypeError)', () => {
  assert.throws(() => getClarificationExpiresAt(Infinity), TypeError);
  assert.throws(() => getProposalExpiresAt(Infinity), TypeError);
});

check('9. now = -Infinity é rejeitado (TypeError)', () => {
  assert.throws(() => getClarificationExpiresAt(-Infinity), TypeError);
  assert.throws(() => getProposalExpiresAt(-Infinity), TypeError);
});

check('10. now fracionário é rejeitado (TypeError) — política integer-only', () => {
  assert.throws(() => getClarificationExpiresAt(1_700_000_000_000.5), TypeError);
  assert.throws(() => getProposalExpiresAt(1_700_000_000_000.5), TypeError);
});

check('10b. now não-número (string/null/undefined) é rejeitado (TypeError)', () => {
  assert.throws(() => getClarificationExpiresAt('1700000000000'), TypeError);
  assert.throws(() => getClarificationExpiresAt(null), TypeError);
  assert.throws(() => getClarificationExpiresAt(undefined), TypeError);
});

check('10c. overflow no resultado (now próximo de MAX_SAFE_INTEGER) é rejeitado (TypeError)', () => {
  assert.throws(() => getClarificationExpiresAt(Number.MAX_SAFE_INTEGER), TypeError);
});

// ============================================================================
// 11-12. AUDITORIA ESTÁTICA — sem relógio global, sem timezone, sem I/O
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/conversation-ttl.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

check('11. nenhum helper usa relógio global (Date.now/new Date)', () => {
  assert.ok(!codeOnly.includes('Date.now'));
  assert.ok(!codeOnly.includes('new Date('));
});

check('12. zero I/O/dependência externa no código real', () => {
  const forbidden = [
    'server-only',
    'Supabase',
    'supabase',
    'fetch(',
    'process.env',
    'Anthropic',
    'userId',
    'stateId',
    'proposalId',
    'runtime-state-storage',
    "from './conversation-turn'",
    "from './proposal-turn'",
    'items',
    'Calendar',
    'import ',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('12b. resultado é aritmética inteira pura — sem arredondamento/conversão de timezone', () => {
  // Se houvesse qualquer conversão via Date (toISOString/getTime/etc.),
  // um now não-múltiplo de 1000 (ms) exporia arredondamento de segundo.
  const now = 1_700_000_000_123;
  assert.equal(getClarificationExpiresAt(now), now + CLARIFICATION_TTL_MS);
  assert.equal(getProposalExpiresAt(now), now + PROPOSAL_TTL_MS);
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
