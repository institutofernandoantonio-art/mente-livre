// Testes unitários de src/lib/conversation/confirmation.ts.
//
// Execução: npm run test:confirmation
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão de
// tests/security/rls.test.mjs e tests/conversation/conversation-turn.test.mjs:
// script node plano, record(name, pass), resumo final, exit code != 0 se
// algo falhar.
//
// Módulo 100% puro (só `import type` de ./proposal-state, erased em
// runtime) — nenhum loader/condição especial é necessário para importá-lo
// diretamente via `node --experimental-strip-types`, diferente de
// conversation-turn.ts.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveProposalConfirmation } from '../../src/lib/conversation/confirmation.ts';

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

// --- Fixture real, sem dado pessoal --------------------------------------

const CREATED_AT = 1_000_000;
const EXPIRES_AT = CREATED_AT + 5 * 60_000;

function fixtureProposalState() {
  return {
    status: 'awaiting_confirmation',
    proposalId: 'fixture-proposal-id',
    action: {
      actionType: 'create_local_task',
      task: {
        title: 'Enviar relatório',
        description: null,
        deadline: null,
        duration: { minutes: 30, source: 'stated' },
      },
    },
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
  };
}

const VALID_NOW = EXPIRES_AT - 1; // ainda não expirada

// ============================================================================
// CONFIRMAÇÃO
// ============================================================================

check('1. "sim" -> confirmed', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'sim', VALID_NOW);
  assert.equal(result.status, 'confirmed');
});

check('2. uppercase "SIM" -> confirmed', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'SIM', VALID_NOW);
  assert.equal(result.status, 'confirmed');
});

check('3. whitespace " sim  " -> confirmed', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), '  sim   ', VALID_NOW);
  assert.equal(result.status, 'confirmed');
});

check('4. pontuação terminal "sim!" -> confirmed', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'sim!', VALID_NOW);
  assert.equal(result.status, 'confirmed');
});

check('5. confirmação inequívoca alternativa "confirma" -> confirmed', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'confirma', VALID_NOW);
  assert.equal(result.status, 'confirmed');
});

check('5b. confirmação inequívoca alternativa "pode fazer." -> confirmed', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'pode fazer.', VALID_NOW);
  assert.equal(result.status, 'confirmed');
});

// ============================================================================
// CANCELAMENTO
// ============================================================================

check('6. "não" -> cancelled', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'não', VALID_NOW);
  assert.equal(result.status, 'cancelled');
});

check('7. "nao" -> cancelled', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'nao', VALID_NOW);
  assert.equal(result.status, 'cancelled');
});

check('8. cancelamento inequívoco alternativo "cancela" -> cancelled', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'cancela', VALID_NOW);
  assert.equal(result.status, 'cancelled');
});

check('8b. cancelamento inequívoco alternativo "deixa pra lá" -> cancelled', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'Deixa pra lá!', VALID_NOW);
  assert.equal(result.status, 'cancelled');
});

// ============================================================================
// AMBIGUOUS / UNRECOGNIZED
// ============================================================================

check('9. "talvez" -> ambiguous', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'talvez', VALID_NOW);
  assert.equal(result.status, 'ambiguous');
});

check('9b. "não sei" -> ambiguous', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'não sei', VALID_NOW);
  assert.equal(result.status, 'ambiguous');
});

check('10. "qual era mesmo a tarefa?" -> unrecognized', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'qual era mesmo a tarefa?', VALID_NOW);
  assert.equal(result.status, 'unrecognized');
});

check('10b. "me explica melhor" -> unrecognized', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'me explica melhor', VALID_NOW);
  assert.equal(result.status, 'unrecognized');
});

check('11. nova intenção substantiva "na verdade coloca para sexta" -> unrecognized', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'na verdade coloca para sexta', VALID_NOW);
  assert.equal(result.status, 'unrecognized');
});

check('11b. nova intenção substantiva "cria também uma reunião amanhã" -> unrecognized', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'cria também uma reunião amanhã', VALID_NOW);
  assert.equal(result.status, 'unrecognized');
});

// ============================================================================
// SEGURANÇA SEMÂNTICA — nunca classificar pela primeira palavra
// ============================================================================

check('12. "sim, mas muda para sexta" -> NÃO confirmed', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'sim, mas muda para sexta', VALID_NOW);
  assert.notEqual(result.status, 'confirmed');
  assert.equal(result.status, 'unrecognized');
});

check('13. "não, cria outra" -> NÃO cancelled', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'não, cria outra', VALID_NOW);
  assert.notEqual(result.status, 'cancelled');
  assert.equal(result.status, 'unrecognized');
});

check('13b. "ok então muda o horário" -> NÃO confirmed', () => {
  const result = resolveProposalConfirmation(fixtureProposalState(), 'ok então muda o horário', VALID_NOW);
  assert.notEqual(result.status, 'confirmed');
  assert.equal(result.status, 'unrecognized');
});

// ============================================================================
// EXPIRAÇÃO
// ============================================================================

check('14. proposal expirada (now >= expiresAt) -> expired', () => {
  const proposal = fixtureProposalState();
  const result = resolveProposalConfirmation(proposal, 'sim', proposal.expiresAt);
  assert.equal(result.status, 'expired');
});

check('14b. now > expiresAt -> expired mesmo com resposta clara', () => {
  const proposal = fixtureProposalState();
  const result = resolveProposalConfirmation(proposal, 'sim', proposal.expiresAt + 1);
  assert.equal(result.status, 'expired');
});

check('15. proposal válida (now < expiresAt) -> resultado normal, não expired', () => {
  const proposal = fixtureProposalState();
  const result = resolveProposalConfirmation(proposal, 'sim', proposal.expiresAt - 1);
  assert.equal(result.status, 'confirmed');
});

// ============================================================================
// IMUTABILIDADE
// ============================================================================

check('16. função não muta ProposalState', () => {
  const proposal = fixtureProposalState();
  const before = JSON.stringify(proposal);
  resolveProposalConfirmation(proposal, 'sim', VALID_NOW);
  resolveProposalConfirmation(proposal, 'não', VALID_NOW);
  resolveProposalConfirmation(proposal, 'talvez', VALID_NOW);
  resolveProposalConfirmation(proposal, 'texto qualquer', VALID_NOW);
  const after = JSON.stringify(proposal);
  assert.equal(before, after);
});

// ============================================================================
// 17-19. PUREZA — verificação estática do arquivo-fonte
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/confirmation.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

check('17. nenhum import server-side (server-only)', () => {
  assert.ok(!codeOnly.includes("'server-only'"));
});

check('18. nenhum import de storage/orchestration/Supabase', () => {
  const forbidden = [
    'runtime-state-storage',
    'runtime-state-validation',
    'orchestration',
    'conversation-turn',
    'createClient',
    '@supabase',
    'consumeRuntimeState',
    'getRuntimeState',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('19. nenhuma Execution/UI/rota', () => {
  const forbidden = [
    '.insert(',
    '.update(',
    '.delete(',
    'Calendar',
    'Anthropic',
    'OpenAI',
    'NextResponse',
    'service_role',
    'createAdminClient',
  ];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

// ============================================================================
// 20. NENHUM stateId EXIGIDO
// ============================================================================

check('20. assinatura não exige stateId (chamada com só proposalState/answer/now funciona)', () => {
  const proposal = fixtureProposalState();
  // Se a assinatura real exigisse mais argumentos obrigatórios, esta
  // chamada já falharia de forma óbvia (TypeScript barra em produção; em
  // runtime JS puro, argumentos extras não fornecidos chegam como
  // `undefined` dentro da função — o teste de imutabilidade e os demais
  // já provam que a função opera corretamente só com estes 3 argumentos).
  const result = resolveProposalConfirmation(proposal, 'sim', VALID_NOW);
  assert.equal(result.status, 'confirmed');
  assert.ok(!('stateId' in result));
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
