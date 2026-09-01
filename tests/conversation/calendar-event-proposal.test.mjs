// Testes puros de src/lib/conversation/calendar-event-proposal.ts —
// Subfase 1 da criação de compromissos no Google Calendar (só a parte
// "IA recomenda": materializar um StructuredIntent.create_event já
// resolvido num ProposedAction.create_calendar_event, zero I/O, zero
// wiring em conversation-turn.ts/proposal-turn.ts).
//
// Execução: npm run test:calendar-event-proposal (node
// --experimental-strip-types, sem react-server: este módulo não tem
// 'server-only' nem qualquer dependência de Next.js/Supabase/Google).
//
// Datas sempre determinísticas (epoch ms literais via Date.UTC) — nenhum
// Date.now() escondido em teste nenhum.

import assert from 'node:assert/strict';
import { buildCreateCalendarEventAction } from '../../src/lib/conversation/calendar-event-proposal.ts';

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

// --- Fixtures --------------------------------------------------------------

function baseIntent(overrides = {}) {
  return {
    intentType: 'create_event',
    missingFields: [],
    confidence: 0.9,
    task: { kind: 'new_task', title: 'Reunião com Ricardo', description: null },
    temporalWindow: { expression: 'amanhã às 14h', resolved: { kind: 'unresolved' } },
    duration: { source: 'stated', value: { minutes: 60 }, confidence: 1 },
    participants: [],
    calendarAction: 'create',
    ...overrides,
  };
}

function stated(minutes) {
  return { source: 'stated', value: { minutes }, confidence: 1 };
}

// ============================================================================
// 1-4. Kinds materializáveis
// ============================================================================

check('1. tomorrow 14:00, duração 60min, America/Sao_Paulo -> action válida', () => {
  const now = Date.UTC(2026, 8, 1, 12, 0, 0); // 2026-09-01T12:00:00Z (09:00 local em Sao Paulo)
  const intent = baseIntent({
    temporalWindow: {
      expression: 'amanhã às 14h',
      resolved: { kind: 'relative_day', day: 'tomorrow', time: { hour: 14, minute: 0 } },
    },
    duration: stated(60),
  });

  const result = buildCreateCalendarEventAction(intent, now, 'America/Sao_Paulo');

  assert.equal(result.status, 'built');
  assert.deepEqual(result.action, {
    actionType: 'create_calendar_event',
    event: {
      title: 'Reunião com Ricardo',
      description: null,
      start: '2026-09-02T17:00:00.000Z',
      end: '2026-09-02T18:00:00.000Z',
      timezone: 'America/Sao_Paulo',
      reminderMinutesBeforeStart: 30,
    },
  });
});

check('2. today + hora explícita -> válida', () => {
  const now = Date.UTC(2026, 8, 1, 12, 0, 0); // 09:00 local em Sao Paulo
  const intent = baseIntent({
    temporalWindow: {
      expression: 'hoje às 15h',
      resolved: { kind: 'relative_day', day: 'today', time: { hour: 15, minute: 0 } },
    },
    duration: stated(30),
  });

  const result = buildCreateCalendarEventAction(intent, now, 'America/Sao_Paulo');

  assert.equal(result.status, 'built');
  assert.equal(result.action.event.start, '2026-09-01T18:00:00.000Z');
  assert.equal(result.action.event.end, '2026-09-01T18:30:00.000Z');
});

check('3a. fixed com start/end/duration coerentes -> built (usa o end da própria janela)', () => {
  const intent = baseIntent({
    temporalWindow: {
      expression: 'das 10h às 10h45 de 5 de setembro',
      // end bate exatamente com start + 45min.
      resolved: { kind: 'fixed', start: '2026-09-05T10:00:00.000Z', end: '2026-09-05T10:45:00.000Z' },
    },
    duration: stated(45),
  });

  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');

  assert.equal(result.status, 'built');
  assert.equal(result.action.event.start, '2026-09-05T10:00:00.000Z');
  assert.equal(result.action.event.end, '2026-09-05T10:45:00.000Z');
});

check('3b. fixed cujo end diverge de start + duration -> invalid (nunca escolhido silenciosamente)', () => {
  const intent = baseIntent({
    temporalWindow: {
      expression: 'das 10h às 23h de 5 de setembro',
      // end (23:00) não bate com start (10:00) + duration (45min = 10:45).
      resolved: { kind: 'fixed', start: '2026-09-05T10:00:00.000Z', end: '2026-09-05T23:00:00.000Z' },
    },
    duration: stated(45),
  });

  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');

  assert.equal(result.status, 'invalid');
});

check('3c. fixed com end <= start -> invalid (nunca bate com start + duration positiva)', () => {
  const intent = baseIntent({
    temporalWindow: {
      expression: 'janela invertida',
      resolved: { kind: 'fixed', start: '2026-09-05T10:00:00.000Z', end: '2026-09-05T09:00:00.000Z' },
    },
    duration: stated(45),
  });

  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');

  assert.equal(result.status, 'invalid');
});

check('4. anchored_start válido -> válida', () => {
  const intent = baseIntent({
    temporalWindow: {
      expression: 'a partir das 8h de 10 de setembro',
      resolved: { kind: 'anchored_start', start: '2026-09-10T08:00:00.000Z' },
    },
    duration: stated(90),
  });

  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');

  assert.equal(result.status, 'built');
  assert.equal(result.action.event.start, '2026-09-10T08:00:00.000Z');
  assert.equal(result.action.event.end, '2026-09-10T09:30:00.000Z');
});

// ============================================================================
// 5, 8-10. Kinds deliberadamente não materializáveis nesta versão
// ============================================================================

check('5. relative_day sem hora -> not_materializable', () => {
  const intent = baseIntent({
    temporalWindow: {
      expression: 'amanhã',
      resolved: { kind: 'relative_day', day: 'tomorrow', time: null },
    },
  });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'America/Sao_Paulo');
  assert.equal(result.status, 'not_materializable');
});

check('8. unresolved temporal -> not_materializable', () => {
  const intent = baseIntent({
    temporalWindow: { expression: 'em algum momento', resolved: { kind: 'unresolved' } },
  });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'America/Sao_Paulo');
  assert.equal(result.status, 'not_materializable');
});

check('9. next_free_slot -> ainda não materializável', () => {
  const intent = baseIntent({
    temporalWindow: {
      expression: 'quando eu tiver um horário livre',
      resolved: { kind: 'next_free_slot', minDurationMinutes: 60 },
    },
  });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'America/Sao_Paulo');
  assert.equal(result.status, 'not_materializable');
});

check('10. relative_to_event -> ainda não materializável', () => {
  const intent = baseIntent({
    temporalWindow: {
      expression: 'antes da reunião com o time',
      resolved: {
        kind: 'relative_to_event',
        anchor: 'before',
        eventReference: { kind: 'existing_reference', raw: 'reunião com o time', resolvedId: null },
      },
    },
  });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'America/Sao_Paulo');
  assert.equal(result.status, 'not_materializable');
});

// ============================================================================
// 6. Duração ausente/unresolved/inválida -> not_materializable
// ============================================================================

const FIXED_WINDOW = {
  expression: 'em instante fixo',
  resolved: { kind: 'fixed', start: '2026-09-05T10:00:00.000Z', end: '2026-09-05T11:00:00.000Z' },
};

check('6a. duração ausente (null) -> not_materializable', () => {
  const intent = baseIntent({ temporalWindow: FIXED_WINDOW, duration: null });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');
  assert.equal(result.status, 'not_materializable');
});

check("6b. duração unresolved -> not_materializable", () => {
  const intent = baseIntent({
    temporalWindow: FIXED_WINDOW,
    duration: { source: 'unresolved', confidence: 0.4 },
  });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');
  assert.equal(result.status, 'not_materializable');
});

check('6c. duração zero -> not_materializable', () => {
  const intent = baseIntent({ temporalWindow: FIXED_WINDOW, duration: stated(0) });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');
  assert.equal(result.status, 'not_materializable');
});

check('6d. duração negativa -> not_materializable', () => {
  const intent = baseIntent({ temporalWindow: FIXED_WINDOW, duration: stated(-30) });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');
  assert.equal(result.status, 'not_materializable');
});

check('6e. duração acima do limite de domínio (> 720min) -> not_materializable', () => {
  const intent = baseIntent({ temporalWindow: FIXED_WINDOW, duration: stated(1000) });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');
  assert.equal(result.status, 'not_materializable');
});

check('6f. duração abaixo do limite de domínio (< 5min) -> not_materializable', () => {
  const intent = baseIntent({ temporalWindow: FIXED_WINDOW, duration: stated(2) });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');
  assert.equal(result.status, 'not_materializable');
});

// ============================================================================
// 7. Timezone/now inválidos -> invalid
// ============================================================================

check('7a. timezone inexistente -> invalid', () => {
  const intent = baseIntent({ temporalWindow: FIXED_WINDOW, duration: stated(30) });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'Nao/Existe');
  assert.equal(result.status, 'invalid');
});

check('7b. timezone vazio -> invalid', () => {
  const intent = baseIntent({ temporalWindow: FIXED_WINDOW, duration: stated(30) });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), '');
  assert.equal(result.status, 'invalid');
});

check('7c. now inválido (NaN) -> invalid', () => {
  const intent = baseIntent({ temporalWindow: FIXED_WINDOW, duration: stated(30) });
  const result = buildCreateCalendarEventAction(intent, NaN, 'UTC');
  assert.equal(result.status, 'invalid');
});

check('7d. now não-inteiro -> invalid', () => {
  const intent = baseIntent({ temporalWindow: FIXED_WINDOW, duration: stated(30) });
  const result = buildCreateCalendarEventAction(intent, 1.5, 'UTC');
  assert.equal(result.status, 'invalid');
});

// ============================================================================
// 11. Mudança de dia civil respeitando America/Sao_Paulo perto da meia-noite UTC
// ============================================================================

check(
  '11. today/tomorrow resolvidos no timezone do usuário, não no UTC do servidor (perto da meia-noite UTC)',
  () => {
    // 2026-09-01T02:00:00Z = 2026-08-31T23:00:00-03:00 em Sao Paulo — já é
    // dia 1º de setembro em UTC, mas ainda é 31 de agosto no timezone do
    // usuário. Se o código usasse o dia civil em UTC (bug), "hoje" seria
    // 1º de setembro; o correto (timezone do usuário) é 31 de agosto.
    const now = Date.UTC(2026, 8, 1, 2, 0, 0);

    const today = baseIntent({
      temporalWindow: {
        expression: 'hoje às 10h',
        resolved: { kind: 'relative_day', day: 'today', time: { hour: 10, minute: 0 } },
      },
      duration: stated(30),
    });
    const tomorrow = baseIntent({
      temporalWindow: {
        expression: 'amanhã às 10h',
        resolved: { kind: 'relative_day', day: 'tomorrow', time: { hour: 10, minute: 0 } },
      },
      duration: stated(30),
    });

    const todayResult = buildCreateCalendarEventAction(today, now, 'America/Sao_Paulo');
    const tomorrowResult = buildCreateCalendarEventAction(tomorrow, now, 'America/Sao_Paulo');

    assert.equal(todayResult.status, 'built');
    assert.equal(tomorrowResult.status, 'built');
    // "hoje" 10h local em Sao Paulo, com now ainda em 31/08 local -> 31/08 13:00Z
    assert.equal(todayResult.action.event.start, '2026-08-31T13:00:00.000Z');
    // "amanhã" 10h local -> 1º/09 13:00Z
    assert.equal(tomorrowResult.action.event.start, '2026-09-01T13:00:00.000Z');
  },
);

// ============================================================================
// 12-13. end exatamente start+duration; reminder sempre 30
// ============================================================================

// anchored_start (não fixed): aqui `duration` é a ÚNICA autoridade sobre o
// fim do evento, sem a checagem de coerência que `fixed` exige (ver 3a-3c)
// — isolando exatamente a fórmula `end = start + duration`.
const ANCHORED_WINDOW = {
  expression: 'a partir das 10h de 5 de setembro',
  resolved: { kind: 'anchored_start', start: '2026-09-05T10:00:00.000Z' },
};

check('12. end é exatamente start + duration, nunca outro valor', () => {
  const intent = baseIntent({ temporalWindow: ANCHORED_WINDOW, duration: stated(37) });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');
  assert.equal(result.status, 'built');
  const startMs = Date.parse(result.action.event.start);
  const endMs = Date.parse(result.action.event.end);
  assert.equal(endMs - startMs, 37 * 60_000);
});

check('13. reminderMinutesBeforeStart é sempre 30, em qualquer action construída', () => {
  const intent = baseIntent({ temporalWindow: ANCHORED_WINDOW, duration: stated(15) });
  const result = buildCreateCalendarEventAction(intent, Date.UTC(2026, 8, 1), 'UTC');
  assert.equal(result.status, 'built');
  assert.equal(result.action.event.reminderMinutesBeforeStart, 30);
});

// ============================================================================
// 14-17. DST — wiring ponta a ponta (relative_day -> resolveCivilDateTimeInTimeZone)
//
// A correção de horário de verão em si é testada exaustivamente em
// tests/conversation/timezone.test.mjs — os testes abaixo provam só que
// ESTE módulo está corretamente conectado a ela (nenhuma reimplementação
// local, nenhum caso tratado diferente do que o helper compartilhado
// decide).
// ============================================================================

check(
  '14. spring-forward: tomorrow (dia de 23h) com hora existente depois da transição -> built, instante correto',
  () => {
    // now = 2027-03-13T15:00:00Z = 10:00 local em America/New_York ->
    // "hoje" = 13/03, "amanhã" = 14/03 (o próprio dia da transição).
    const now = Date.UTC(2027, 2, 13, 15, 0, 0);
    const intent = baseIntent({
      temporalWindow: {
        expression: 'amanhã às 10h',
        resolved: { kind: 'relative_day', day: 'tomorrow', time: { hour: 10, minute: 0 } },
      },
      duration: stated(60),
    });

    const result = buildCreateCalendarEventAction(intent, now, 'America/New_York');

    assert.equal(result.status, 'built');
    assert.equal(result.action.event.start, '2027-03-14T14:00:00.000Z');
    assert.equal(result.action.event.end, '2027-03-14T15:00:00.000Z');
  },
);

check('15. spring-forward: horário civil inexistente (amanhã 02:30, lacuna) -> not_materializable', () => {
  const now = Date.UTC(2027, 2, 13, 15, 0, 0); // amanhã = 14/03 (dia da transição)
  const intent = baseIntent({
    temporalWindow: {
      expression: 'amanhã às 2h30',
      resolved: { kind: 'relative_day', day: 'tomorrow', time: { hour: 2, minute: 30 } },
    },
    duration: stated(60),
  });

  const result = buildCreateCalendarEventAction(intent, now, 'America/New_York');

  assert.equal(result.status, 'not_materializable');
});

check('16. fall-back: horário civil ambíguo (hoje 01:30, sobreposição) -> not_materializable', () => {
  const now = Date.UTC(2027, 10, 7, 15, 0, 0); // 10:00 local (EST) em 07/11/2027 -> "hoje" = 07/11
  const intent = baseIntent({
    temporalWindow: {
      expression: 'hoje à 1h30',
      resolved: { kind: 'relative_day', day: 'today', time: { hour: 1, minute: 30 } },
    },
    duration: stated(60),
  });

  const result = buildCreateCalendarEventAction(intent, now, 'America/New_York');

  assert.equal(result.status, 'not_materializable');
});

check('17. fall-back: horário normal no mesmo dia da ambiguidade continua correto -> built', () => {
  const now = Date.UTC(2027, 10, 7, 15, 0, 0); // "hoje" = 07/11/2027
  const intent = baseIntent({
    temporalWindow: {
      expression: 'hoje às 10h',
      resolved: { kind: 'relative_day', day: 'today', time: { hour: 10, minute: 0 } },
    },
    duration: stated(60),
  });

  const result = buildCreateCalendarEventAction(intent, now, 'America/New_York');

  assert.equal(result.status, 'built');
  assert.equal(result.action.event.start, '2027-11-07T15:00:00.000Z');
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
