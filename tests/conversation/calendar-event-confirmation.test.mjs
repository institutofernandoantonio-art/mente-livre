// Testes unitários de src/lib/conversation/calendar-event-confirmation.ts
// — o orquestrador gate -> claim -> Google -> finalize (Subfase 9 e,
// nesta atualização, Subfase 10 — gate seguro para conexões antigas
// freebusy-only — da criação de compromissos no Google Calendar).
//
// Execução: npm run test:calendar-event-confirmation
//
// Sem framework (nenhum instalado no projeto) — mesmo padrão do resto de
// tests/conversation/. Quatro peças são substituídas, via dublês
// redirecionados só neste processo de teste (ver
// tests/support/ts-extension-loader.mjs): `./calendar-event-claim`,
// `./calendar-event-execution`, `./calendar-event-finalize` e
// `../google/calendar` (só `hasGoogleCalendarEventWriteAuthorization`) —
// os specifiers EXATOS escritos dentro de calendar-event-confirmation.ts.
// Nenhuma chamada real ao Google/Supabase acontece em execução alguma
// deste arquivo. Estes testes provam o CONTRATO do orquestrador
// (sequenciamento exato do gate + 3 passos, mapeamento de cada combinação
// de resultados, zero retry/requery) — nunca o comportamento real do
// próprio gate/claim/execução Google/finalize (cobertos por seus próprios
// arquivos de teste).
//
// `googleHandlers.hasGoogleCalendarEventWriteAuthorization` é
// inicializado como `'authorized'` logo abaixo, ANTES de qualquer teste —
// todos os testes já existentes (Subfase 9, sobre claim/Google/finalize)
// continuam válidos sem nenhuma alteração, porque simplesmente não
// competia a eles decidir o gate. Os testes NOVOS desta atualização
// (seção "SUBFASE 10 — GATE") ficam deliberadamente no FINAL do arquivo,
// depois de todo o resto, para que sobrescrever o gate para
// 'unauthorized'/'error' dentro deles nunca vaze para nenhum teste
// anterior.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { confirmCalendarEvent } from '../../src/lib/conversation/calendar-event-confirmation.ts';
import { handlers as claimHandlers } from '../support/fake-calendar-event-claim.mjs';
import { handlers as executionHandlers } from '../support/fake-calendar-event-execution.mjs';
import { handlers as finalizeHandlers } from '../support/fake-calendar-event-finalize.mjs';
import { handlers as googleHandlers } from '../support/fake-google-calendar.mjs';

// Default global — ver nota acima. Só os testes da seção "SUBFASE 10 —
// GATE" (no final do arquivo) sobrescrevem isto.
googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => 'authorized';

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function check(name, fn) {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    record(name, false, err.message);
  }
}

function neverCalled(name) {
  return async (...args) => {
    throw new Error(`${name} não deveria ter sido chamado, foi chamado com ${JSON.stringify(args)}`);
  };
}

function setHandlers(overrides = {}) {
  claimHandlers.claimCalendarEventExecution = overrides.claim ?? neverCalled('claimCalendarEventExecution');
  executionHandlers.executeCreateCalendarEvent = overrides.execute ?? neverCalled('executeCreateCalendarEvent');
  finalizeHandlers.finalizeCalendarEventExecution = overrides.finalize ?? neverCalled('finalizeCalendarEventExecution');
}

const VALID_EVENT_ID = 'abcdef0123456789abcdef0123456789';

const CALENDAR_EVENT = {
  title: 'Reunião com Ricardo',
  description: null,
  start: '2026-09-02T17:00:00.000Z',
  end: '2026-09-02T18:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  reminderMinutesBeforeStart: 30,
};

const CALENDAR_ACTION = { actionType: 'create_calendar_event', event: CALENDAR_EVENT };

const VALID_INPUT = {
  expectedStateId: 'state-1',
  proposalId: 'proposal-1',
  action: CALENDAR_ACTION,
};

function capturingClaim(responder) {
  const calls = [];
  claimHandlers.claimCalendarEventExecution = async (input) => {
    calls.push(input);
    return responder(input);
  };
  return calls;
}

function capturingExecute(responder) {
  const calls = [];
  executionHandlers.executeCreateCalendarEvent = async (input) => {
    calls.push(input);
    return responder(input);
  };
  return calls;
}

function capturingFinalize(responder) {
  const calls = [];
  finalizeHandlers.finalizeCalendarEventExecution = async (input) => {
    calls.push(input);
    return responder(input);
  };
  return calls;
}

// ============================================================================
// 1-3, 14, 20. CLAIM — claimed/already_claimed seguem para Google com o
// MESMO googleEventId; exatamente 1 chamada de claim
// ============================================================================

await check('1 e 14. claim claimed -> Google é chamado; claim chamado exatamente 1 vez', async () => {
  const claimCalls = capturingClaim(() => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }));
  const executeCalls = capturingExecute(() => ({ status: 'created' }));
  capturingFinalize(() => ({ status: 'completed' }));

  await confirmCalendarEvent(VALID_INPUT);

  assert.equal(claimCalls.length, 1);
  assert.equal(executeCalls.length, 1);
});

await check('2. claim already_claimed -> Google também é chamado (nunca tratado como erro)', async () => {
  capturingClaim(() => ({ status: 'already_claimed', googleEventId: VALID_EVENT_ID }));
  const executeCalls = capturingExecute(() => ({ status: 'already_exists' }));
  capturingFinalize(() => ({ status: 'completed' }));

  const result = await confirmCalendarEvent(VALID_INPUT);

  assert.equal(executeCalls.length, 1);
  assert.deepEqual(result, { status: 'completed' });
});

await check(
  '3 e 20. o MESMO googleEventId do claim é reutilizado no Google — nenhum id novo é gerado localmente (claimed e already_claimed)',
  async () => {
    for (const claimStatus of ['claimed', 'already_claimed']) {
      capturingClaim(() => ({ status: claimStatus, googleEventId: VALID_EVENT_ID }));
      const executeCalls = capturingExecute(() => ({ status: 'created' }));
      capturingFinalize(() => ({ status: 'completed' }));

      await confirmCalendarEvent(VALID_INPUT);

      assert.equal(executeCalls[0].googleEventId, VALID_EVENT_ID, `status ${claimStatus} não reutilizou o googleEventId`);
    }
  },
);

// ============================================================================
// 4-5. CLAIM conflict/error -> zero Google, zero finalize
// ============================================================================

await check('4. claim conflict -> conflict, zero Google, zero finalize', async () => {
  capturingClaim(() => ({ status: 'conflict' }));
  // executionHandlers/finalizeHandlers permanecem "neverCalled" (setHandlers
  // não usado aqui) — capturingClaim não sobrescreve os outros dois.
  setHandlers({ claim: async () => ({ status: 'conflict' }) });
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'conflict' });
});

await check('5. claim error -> error, zero Google, zero finalize', async () => {
  setHandlers({ claim: async () => ({ status: 'error' }) });
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'error' });
});

// ============================================================================
// 6-9. GOOGLE — created/already_exists seguem para finalize;
// unauthorized/error param, zero finalize
// ============================================================================

await check('6. created -> finalize é chamado', async () => {
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'created' }),
  });
  const finalizeCalls = capturingFinalize(() => ({ status: 'completed' }));
  await confirmCalendarEvent(VALID_INPUT);
  assert.equal(finalizeCalls.length, 1);
});

await check('7. already_exists -> finalize também é chamado (sucesso idempotente)', async () => {
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'already_exists' }),
  });
  const finalizeCalls = capturingFinalize(() => ({ status: 'completed' }));
  await confirmCalendarEvent(VALID_INPUT);
  assert.equal(finalizeCalls.length, 1);
});

await check('8. unauthorized -> authorization_required, ZERO finalize', async () => {
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'unauthorized' }),
  });
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'authorization_required' });
});

await check('9. Google error -> execution_uncertain, ZERO finalize', async () => {
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'error' }),
  });
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'execution_uncertain' });
});

// ============================================================================
// 10-13. FINALIZE — completed/already_completed -> completed;
// conflict/error -> finalization_pending (NUNCA afirma que a criação falhou)
// ============================================================================

await check('10. finalize completed -> completed', async () => {
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'created' }),
    finalize: async () => ({ status: 'completed' }),
  });
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'completed' });
});

await check('11. finalize already_completed -> completed', async () => {
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'created' }),
    finalize: async () => ({ status: 'already_completed' }),
  });
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'completed' });
});

await check('12. finalize conflict -> finalization_pending (Google já confirmou; nunca "falhou")', async () => {
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'created' }),
    finalize: async () => ({ status: 'conflict' }),
  });
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'finalization_pending' });
});

await check('13. finalize error -> finalization_pending (mesma razão)', async () => {
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'created' }),
    finalize: async () => ({ status: 'error' }),
  });
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'finalization_pending' });
});

// ============================================================================
// 15-18. Exatamente 1 chamada por passo aplicável; zero retry/requery
// ============================================================================

await check('15, 16 e 17. exatamente 1 claim + 1 Google + 1 finalize por tentativa bem-sucedida — zero retry', async () => {
  let claimCalls = 0;
  let executeCalls = 0;
  let finalizeCalls = 0;
  setHandlers({
    claim: async () => {
      claimCalls++;
      return { status: 'claimed', googleEventId: VALID_EVENT_ID };
    },
    execute: async () => {
      executeCalls++;
      return { status: 'created' };
    },
    finalize: async () => {
      finalizeCalls++;
      return { status: 'completed' };
    },
  });
  await confirmCalendarEvent(VALID_INPUT);
  assert.equal(claimCalls, 1);
  assert.equal(executeCalls, 1);
  assert.equal(finalizeCalls, 1);
});

await check('16b. authorization_required/execution_uncertain -> ZERO chamada de finalize (call count)', async () => {
  for (const executeStatus of ['unauthorized', 'error']) {
    let finalizeCalls = 0;
    setHandlers({
      claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
      execute: async () => ({ status: executeStatus }),
      finalize: async () => {
        finalizeCalls++;
        return { status: 'completed' };
      },
    });
    await confirmCalendarEvent(VALID_INPUT);
    assert.equal(finalizeCalls, 0, `finalize não deveria ser chamado para execute status ${executeStatus}`);
  }
});

await check('18. conflict/error do claim -> ZERO chamada de execute/finalize (call count)', async () => {
  for (const claimStatus of ['conflict', 'error']) {
    let executeCalls = 0;
    let finalizeCalls = 0;
    setHandlers({
      claim: async () => ({ status: claimStatus }),
      execute: async () => {
        executeCalls++;
        return { status: 'created' };
      },
      finalize: async () => {
        finalizeCalls++;
        return { status: 'completed' };
      },
    });
    await confirmCalendarEvent(VALID_INPUT);
    assert.equal(executeCalls, 0, `execute não deveria ser chamado para claim status ${claimStatus}`);
    assert.equal(finalizeCalls, 0, `finalize não deveria ser chamado para claim status ${claimStatus}`);
  }
});

// ============================================================================
// 19. A ação recebida é exatamente a proposta já validada — nenhuma
// transformação/reconstrução
// ============================================================================

await check('19. executeCreateCalendarEvent recebe exatamente action.event (mesma referência)', async () => {
  setHandlers({ claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }) });
  const executeCalls = capturingExecute(() => ({ status: 'created' }));
  capturingFinalize(() => ({ status: 'completed' }));

  await confirmCalendarEvent(VALID_INPUT);

  assert.equal(executeCalls[0].event, CALENDAR_EVENT, 'deveria ser a MESMA referência de action.event, nunca uma cópia');
});

await check(
  '19b. claim/finalize recebem exatamente expectedStateId/proposalId do input, nada mais',
  async () => {
    const claimCalls = capturingClaim(() => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }));
    capturingExecute(() => ({ status: 'created' }));
    const finalizeCalls = capturingFinalize(() => ({ status: 'completed' }));

    await confirmCalendarEvent({ expectedStateId: 'distinctive-state', proposalId: 'distinctive-proposal', action: CALENDAR_ACTION });

    assert.deepEqual(claimCalls[0], { expectedStateId: 'distinctive-state', proposalId: 'distinctive-proposal' });
    assert.deepEqual(finalizeCalls[0], { expectedStateId: 'distinctive-state', proposalId: 'distinctive-proposal' });
  },
);

// ============================================================================
// SUBFASE 10 — GATE de autorização de escrita, ANTES de qualquer claim.
// Deliberadamente a ÚLTIMA seção de testes comportamentais deste arquivo
// (ver nota no cabeçalho) — cada teste abaixo configura o gate para o que
// precisa, sem risco de vazar para nenhum teste anterior.
// ============================================================================

await check('34, 35, 36 e 37. gate unauthorized -> authorization_required, ZERO claim, ZERO Google, ZERO finalize', async () => {
  googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => 'unauthorized';
  setHandlers({}); // claim/execute/finalize todos "neverCalled"
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'authorization_required' });
});

await check('38, 39 e 40. erro ao checar o gate -> error, ZERO claim, ZERO Google (finalize também nunca alcançável)', async () => {
  googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => 'error';
  setHandlers({}); // claim/execute/finalize todos "neverCalled"
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'error' });
});

await check('gate error é DISTINTO de gate unauthorized — nunca colapsados no mesmo status externo', async () => {
  googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => 'unauthorized';
  setHandlers({});
  const unauthorizedResult = await confirmCalendarEvent(VALID_INPUT);

  googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => 'error';
  setHandlers({});
  const errorResult = await confirmCalendarEvent(VALID_INPUT);

  assert.notDeepEqual(unauthorizedResult, errorResult);
});

await check('41 e 42. gate authorized -> segue para claim; lifecycle existente (claim/Google/finalize) continua idêntico depois do gate', async () => {
  googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => 'authorized';
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'created' }),
    finalize: async () => ({ status: 'completed' }),
  });
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'completed' });
});

await check('43. gate authorized + claimed/already_claimed continuam funcionando normalmente', async () => {
  for (const claimStatus of ['claimed', 'already_claimed']) {
    googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => 'authorized';
    setHandlers({
      claim: async () => ({ status: claimStatus, googleEventId: VALID_EVENT_ID }),
      execute: async () => ({ status: 'created' }),
      finalize: async () => ({ status: 'completed' }),
    });
    const result = await confirmCalendarEvent(VALID_INPUT);
    assert.deepEqual(result, { status: 'completed' }, `falhou para claim status ${claimStatus}`);
  }
});

await check('44. gate authorized + created/already_exists continuam indo para finalize normalmente', async () => {
  for (const executeStatus of ['created', 'already_exists']) {
    googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => 'authorized';
    let finalizeCalls = 0;
    setHandlers({
      claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
      execute: async () => ({ status: executeStatus }),
      finalize: async () => {
        finalizeCalls++;
        return { status: 'completed' };
      },
    });
    await confirmCalendarEvent(VALID_INPUT);
    assert.equal(finalizeCalls, 1, `finalize deveria ter sido chamado para execute status ${executeStatus}`);
  }
});

await check('45. gate authorized + unauthorized do PRÓPRIO Google (depois do claim) continua retornando authorization_required', async () => {
  googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => 'authorized';
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'unauthorized' }),
  });
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'authorization_required' });
});

await check('46. gate authorized + erro do Google continua retornando execution_uncertain', async () => {
  googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => 'authorized';
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'error' }),
  });
  const result = await confirmCalendarEvent(VALID_INPUT);
  assert.deepEqual(result, { status: 'execution_uncertain' });
});

await check('gate é consultado exatamente 1 vez por execução (zero retry/requery do próprio gate)', async () => {
  let gateCalls = 0;
  googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => {
    gateCalls++;
    return 'authorized';
  };
  setHandlers({
    claim: async () => ({ status: 'claimed', googleEventId: VALID_EVENT_ID }),
    execute: async () => ({ status: 'created' }),
    finalize: async () => ({ status: 'completed' }),
  });
  await confirmCalendarEvent(VALID_INPUT);
  assert.equal(gateCalls, 1);
});

await check('gate lançando exceção propaga (rejeita), mesma convenção do resto do módulo', async () => {
  googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => {
    throw new Error('falha inesperada fora do contrato de retorno');
  };
  setHandlers({});
  await assert.rejects(() => confirmCalendarEvent(VALID_INPUT), /falha inesperada fora do contrato de retorno/);
});

// Restaura o default para 'authorized' — última linha de defesa caso
// algum teste futuro seja adicionado depois desta seção sem configurar o
// gate explicitamente.
googleHandlers.hasGoogleCalendarEventWriteAuthorization = async () => 'authorized';

// ============================================================================
// AUDITORIA ESTÁTICA — zero admin/service-role, zero geração de id, zero
// Calendar API direta, server-only
// ============================================================================

const sourcePath = fileURLToPath(new URL('../../src/lib/conversation/calendar-event-confirmation.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const codeOnly = source
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

await check('20b. módulo nunca gera id (zero crypto.randomUUID/lower(replace)) — googleEventId vem SÓ do claim', () => {
  assert.ok(!codeOnly.includes('crypto.randomUUID'));
  assert.ok(!codeOnly.includes('randomUUID'));
});

await check('zero admin/service-role/fetch direto — usa só as 3 abstrações importadas', () => {
  const forbidden = ['createAdminClient', 'service_role', 'SUPABASE_SECRET_KEY', 'fetch(', 'googleapis.com', 'createClient('];
  for (const token of forbidden) {
    assert.ok(!codeOnly.includes(token), `token proibido encontrado: ${token}`);
  }
});

await check('usa as 3 abstrações reais, cada uma exatamente 1 vez no código (nenhuma chamada duplicada)', () => {
  const claimCallSites = [...codeOnly.matchAll(/claimCalendarEventExecution\(/g)];
  const executeCallSites = [...codeOnly.matchAll(/executeCreateCalendarEvent\(/g)];
  const finalizeCallSites = [...codeOnly.matchAll(/finalizeCalendarEventExecution\(/g)];
  assert.equal(claimCallSites.length, 1);
  assert.equal(executeCallSites.length, 1);
  assert.equal(finalizeCallSites.length, 1);
});

await check(
  '(Subfase 10) hasGoogleCalendarEventWriteAuthorization é importado de ../google/calendar e chamado exatamente 1 vez',
  () => {
    assert.ok(codeOnly.includes("from '../google/calendar'"));
    const gateCallSites = [...codeOnly.matchAll(/hasGoogleCalendarEventWriteAuthorization\(/g)];
    // 1 na chamada real + 1 na própria linha de import (nomeia a função) —
    // nunca uma segunda chamada real.
    assert.ok(gateCallSites.length >= 1);
    const realCallSites = [...codeOnly.matchAll(/await hasGoogleCalendarEventWriteAuthorization\(/g)];
    assert.equal(realCallSites.length, 1, 'gate deveria ser chamado (com await) exatamente 1 vez no código real');
  },
);

await check(
  '8 (prova de ordem). o gate é textualmente chamado ANTES do claim no código-fonte — Passo 0 precede o Passo 1',
  () => {
    const gateIndex = codeOnly.indexOf('await hasGoogleCalendarEventWriteAuthorization(');
    const claimIndex = codeOnly.indexOf('await claimCalendarEventExecution(');
    assert.ok(gateIndex !== -1 && claimIndex !== -1);
    assert.ok(gateIndex < claimIndex, 'o gate deveria aparecer antes do claim no código-fonte');
  },
);

await check('módulo é server-only', () => {
  assert.ok(codeOnly.includes("import 'server-only'"));
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
