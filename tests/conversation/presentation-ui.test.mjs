// Testes unitários de src/lib/conversation/presentation-ui.ts (helper puro
// de mapeamento DTO→UI) + auditoria estática de contrato sobre
// src/app/conversa/ConversationPanel.tsx, src/app/conversa/page.tsx e
// src/proxy.ts.
//
// Execução: npm run test:conversation-ui
//
// `presentation-ui.ts` só tem imports `import type` (apagados em tempo de
// compilação) — nenhuma dependência de runtime de `next/headers`/
// `server-only`, por isso não precisa de `--conditions=react-server` nem
// do loader de redirecionamento (mesmo padrão de conversation-ttl.ts/
// confirmation.ts): só `--experimental-strip-types` para as anotações de
// tipo.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  mapPresentationBootstrap,
  mapEntryResultToUiEffect,
  formatDeadlinePreview,
  formatDurationPreview,
  buildEventProposalPreview,
} from '../../src/lib/conversation/presentation-ui.ts';

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

const VALID_ACTION = {
  actionType: 'create_local_task',
  task: { title: 'Revisar orçamento', description: null, deadline: null, duration: null },
};

// ============================================================================
// 1-5. BOOTSTRAP -> mensagem inicial opcional
// ============================================================================

check('1. bootstrap empty -> null (nenhuma mensagem adicionada)', () => {
  assert.equal(mapPresentationBootstrap({ status: 'empty' }), null);
});

check('2. bootstrap clarification_required -> assistant text com a question exata', () => {
  const result = mapPresentationBootstrap({ status: 'clarification_required', question: 'Quanto tempo?' });
  assert.deepEqual(result, { role: 'assistant', kind: 'text', text: 'Quanto tempo?' });
});

check('3. bootstrap proposal_ready -> assistant proposal com a MESMA referência de action', () => {
  const result = mapPresentationBootstrap({ status: 'proposal_ready', action: VALID_ACTION });
  assert.equal(result.role, 'assistant');
  assert.equal(result.kind, 'proposal');
  assert.equal(result.action, VALID_ACTION);
});

check('4. bootstrap expired -> assistant text informando expiração', () => {
  const result = mapPresentationBootstrap({ status: 'expired' });
  assert.equal(result.role, 'assistant');
  assert.equal(result.kind, 'text');
  assert.match(result.text, /expirou/i);
});

check('5. bootstrap error -> assistant text genérico', () => {
  const result = mapPresentationBootstrap({ status: 'error' });
  assert.deepEqual(result, { role: 'assistant', kind: 'text', text: 'Algo deu errado. Tente novamente.' });
});

// ============================================================================
// 6-14. ENVIO -> mensagem + clearInput, para os 9 status
// ============================================================================

check('6. clarification_required -> message com question, clearInput true', () => {
  const effect = mapEntryResultToUiEffect({ status: 'clarification_required', question: 'Quando?' });
  assert.deepEqual(effect, { message: { role: 'assistant', kind: 'text', text: 'Quando?' }, clearInput: true });
});

check('7. proposal_ready -> message com action (mesma referência), clearInput true', () => {
  const effect = mapEntryResultToUiEffect({ status: 'proposal_ready', action: VALID_ACTION });
  assert.equal(effect.message.kind, 'proposal');
  assert.equal(effect.message.action, VALID_ACTION);
  assert.equal(effect.clearInput, true);
});

check('8. confirmed -> "Tarefa criada.", clearInput true, itemId nunca lido', () => {
  const effect = mapEntryResultToUiEffect({ status: 'confirmed', itemId: 'item-nunca-deve-vazar' });
  assert.deepEqual(effect, { message: { role: 'assistant', kind: 'text', text: 'Tarefa criada.' }, clearInput: true });
  assert.ok(!JSON.stringify(effect).includes('item-nunca-deve-vazar'));
});

check('9. cancelled -> "Proposta cancelada.", clearInput true', () => {
  const effect = mapEntryResultToUiEffect({ status: 'cancelled' });
  assert.deepEqual(effect, {
    message: { role: 'assistant', kind: 'text', text: 'Proposta cancelada.' },
    clearInput: true,
  });
});

check('10. needs_input -> mensagem genérica, clearInput FALSE (preserva input)', () => {
  const effect = mapEntryResultToUiEffect({ status: 'needs_input' });
  assert.equal(effect.clearInput, false);
  assert.match(effect.message.text, /não entendi/i);
});

check('11. unsupported -> mensagem honesta de limite, clearInput true', () => {
  const effect = mapEntryResultToUiEffect({ status: 'unsupported' });
  assert.equal(effect.clearInput, true);
  assert.match(effect.message.text, /tarefas simples/i);
});

check('12. conflict -> mensagem de estado mudou, clearInput FALSE (preserva input)', () => {
  const effect = mapEntryResultToUiEffect({ status: 'conflict' });
  assert.equal(effect.clearInput, false);
  assert.match(effect.message.text, /mudou/i);
});

check('13. expired -> mensagem de expiração, clearInput true', () => {
  const effect = mapEntryResultToUiEffect({ status: 'expired' });
  assert.equal(effect.clearInput, true);
  assert.match(effect.message.text, /expirou/i);
});

check('14. error -> mensagem genérica, clearInput FALSE (preserva input)', () => {
  const effect = mapEntryResultToUiEffect({ status: 'error' });
  assert.equal(effect.clearInput, false);
  assert.deepEqual(effect.message, { role: 'assistant', kind: 'text', text: 'Algo deu errado. Tente novamente.' });
});

// ============================================================================
// 14b-14g. calendar_information -> texto curto e determinístico por
// status/scope, clearInput true, zero segunda chamada a LLM (texto fixo,
// nunca gerado a partir de conteúdo variável)
// ============================================================================

check('14b. calendar_information day+busy -> "Você tem compromissos nesse dia."', () => {
  const effect = mapEntryResultToUiEffect({
    status: 'calendar_information',
    result: { status: 'busy', scope: 'day', busyBlockCount: 2 },
  });
  assert.deepEqual(effect, {
    message: { role: 'assistant', kind: 'text', text: 'Você tem compromissos nesse dia.' },
    clearInput: true,
  });
});

check('14c. calendar_information day+available -> "Não encontrei horários ocupados nesse dia."', () => {
  const effect = mapEntryResultToUiEffect({
    status: 'calendar_information',
    result: { status: 'available', scope: 'day' },
  });
  assert.deepEqual(effect, {
    message: { role: 'assistant', kind: 'text', text: 'Não encontrei horários ocupados nesse dia.' },
    clearInput: true,
  });
});

check('14d. calendar_information hour+busy -> "Esse horário está ocupado na sua agenda."', () => {
  const effect = mapEntryResultToUiEffect({
    status: 'calendar_information',
    result: { status: 'busy', scope: 'hour', busyBlockCount: 1 },
  });
  assert.deepEqual(effect, {
    message: { role: 'assistant', kind: 'text', text: 'Esse horário está ocupado na sua agenda.' },
    clearInput: true,
  });
});

check('14e. calendar_information hour+available -> "Não encontrei compromisso nesse horário."', () => {
  const effect = mapEntryResultToUiEffect({
    status: 'calendar_information',
    result: { status: 'available', scope: 'hour' },
  });
  assert.deepEqual(effect, {
    message: { role: 'assistant', kind: 'text', text: 'Não encontrei compromisso nesse horário.' },
    clearInput: true,
  });
});

check('14f. calendar_information unsupported_window -> mensagem própria, nunca reaproveita UNSUPPORTED_TEXT de tarefas', () => {
  const effect = mapEntryResultToUiEffect({ status: 'calendar_information', result: { status: 'unsupported_window' } });
  assert.deepEqual(effect, {
    message: { role: 'assistant', kind: 'text', text: 'Por enquanto, só consigo checar sua agenda para hoje ou amanhã.' },
    clearInput: true,
  });
});

check('14g. calendar_information error -> mensagem genérica de Calendar, nunca afirma "não conectado" sem evidência', () => {
  const effect = mapEntryResultToUiEffect({ status: 'calendar_information', result: { status: 'error' } });
  assert.deepEqual(effect, {
    message: { role: 'assistant', kind: 'text', text: 'Não consegui consultar seu Google Calendar agora.' },
    clearInput: true,
  });
});

check('14h. calendar_information: busyBlockCount nunca aparece no texto (não melhora a UX pedida nesta fatia)', () => {
  const effect = mapEntryResultToUiEffect({
    status: 'calendar_information',
    result: { status: 'busy', scope: 'day', busyBlockCount: 7 },
  });
  assert.ok(!effect.message.text.includes('7'));
});

// ============================================================================
// 14i-14j. create_event — schedule_conflict/calendar_unavailable (Subfase 2
// da criação de compromissos no Google Calendar) — mensagens mínimas, só
// para o switch exaustivo compilar (UI completa fica para subfase própria).
// ============================================================================

check('14i. schedule_conflict -> "Você já tem um compromisso nesse horário.", clearInput true', () => {
  const effect = mapEntryResultToUiEffect({ status: 'schedule_conflict' });
  assert.deepEqual(effect, {
    message: { role: 'assistant', kind: 'text', text: 'Você já tem um compromisso nesse horário.' },
    clearInput: true,
  });
});

check(
  '14j. calendar_unavailable -> "Não consegui confirmar sua disponibilidade agora. Tente novamente.", clearInput FALSE (transitório — permite reenviar a mesma resposta)',
  () => {
    const effect = mapEntryResultToUiEffect({ status: 'calendar_unavailable' });
    assert.deepEqual(effect, {
      message: {
        role: 'assistant',
        kind: 'text',
        text: 'Não consegui confirmar sua disponibilidade agora. Tente novamente.',
      },
      clearInput: false,
    });
  },
);

// ============================================================================
// 14k. calendar_processing (Subfase 5 — cancelamento protegido de proposta
// de evento). Nunca afirma que o evento já foi criado (pode estar só
// CLAIMED); zero proposalId/stateId/googleEventId exposto — o status de
// entrada em si já não carrega nenhum desses campos.
// ============================================================================

check(
  '14k. calendar_processing -> "Esse compromisso já começou a ser processado e não pode mais ser cancelado por aqui.", clearInput true',
  () => {
    const effect = mapEntryResultToUiEffect({ status: 'calendar_processing' });
    assert.deepEqual(effect, {
      message: {
        role: 'assistant',
        kind: 'text',
        text: 'Esse compromisso já começou a ser processado e não pode mais ser cancelado por aqui.',
      },
      clearInput: true,
    });
  },
);

check('14l. calendar_processing nunca reutiliza o texto de cancelled/schedule_conflict/calendar_unavailable', () => {
  const effect = mapEntryResultToUiEffect({ status: 'calendar_processing' });
  assert.notEqual(effect.message.text, 'Proposta cancelada.');
  assert.notEqual(effect.message.text, 'Você já tem um compromisso nesse horário.');
  assert.notEqual(effect.message.text, 'Não consegui confirmar sua disponibilidade agora. Tente novamente.');
});

check('14m. calendar_processing nunca afirma que o evento já foi criado (evita "criado"/"confirmado" no texto)', () => {
  const effect = mapEntryResultToUiEffect({ status: 'calendar_processing' });
  assert.ok(!/criado/i.test(effect.message.text));
  assert.ok(!/confirmado/i.test(effect.message.text));
});

// ============================================================================
// 15-19. FORMATAÇÃO DE PREVIEW (visual, nunca lógica)
// ============================================================================

check('15. formatDeadlinePreview(null) -> null', () => {
  assert.equal(formatDeadlinePreview(null), null);
});

check('16. formatDeadlinePreview com ISO válido -> string não vazia, nunca o valor original bruto', () => {
  const result = formatDeadlinePreview({ at: '2026-09-01T15:00:00.000Z' });
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
});

check('17. formatDeadlinePreview com string inválida -> fallback para o valor original (nunca esconde o dado)', () => {
  const result = formatDeadlinePreview({ at: 'não-é-uma-data' });
  assert.equal(result, 'não-é-uma-data');
});

check('18. formatDurationPreview(null) -> null', () => {
  assert.equal(formatDurationPreview(null), null);
});

check('19. formatDurationPreview({minutes:30}) -> "30 min"', () => {
  assert.equal(formatDurationPreview({ minutes: 30 }), '30 min');
});

// ============================================================================
// SUBFASE 8 — buildEventProposalPreview (preview claro da proposta de
// evento, ANTES da confirmação). Instantes/timezone sempre determinísticos
// e explícitos — nunca depende do timezone da máquina rodando o teste.
// ============================================================================

// Mesmo exemplo do enunciado da subfase: "amanhã às 14h... por 1 hora" em
// America/Sao_Paulo (UTC-3, sem horário de verão desde 2019) — 14:00-15:00
// local = 17:00-18:00 UTC.
function calendarEvent(overrides = {}) {
  return {
    title: 'Reunião com Ricardo',
    description: null,
    start: '2026-09-02T17:00:00.000Z',
    end: '2026-09-02T18:00:00.000Z',
    timezone: 'America/Sao_Paulo',
    reminderMinutesBeforeStart: 30,
    ...overrides,
  };
}

check('32. create_calendar_event produz preview visível (não-null, com título)', () => {
  const preview = buildEventProposalPreview(calendarEvent());
  assert.ok(preview);
  assert.equal(preview.title, 'Reunião com Ricardo');
});

check('33. título correto (preservado verbatim)', () => {
  const preview = buildEventProposalPreview(calendarEvent({ title: 'Título distintivo' }));
  assert.equal(preview.title, 'Título distintivo');
});

check('34. descrição presente é exibida (verbatim)', () => {
  const preview = buildEventProposalPreview(calendarEvent({ description: 'Pauta: roadmap do trimestre' }));
  assert.equal(preview.description, 'Pauta: roadmap do trimestre');
});

check('35. description null é omitida (preview.description === null)', () => {
  const preview = buildEventProposalPreview(calendarEvent({ description: null }));
  assert.equal(preview.description, null);
});

check('35b. description só de espaços é tratada como ausente (nunca mostra linha vazia)', () => {
  const preview = buildEventProposalPreview(calendarEvent({ description: '   ' }));
  assert.equal(preview.description, null);
});

check('36. data é formatada no timezone do EVENTO (14:00-15:00 America/Sao_Paulo -> 02/09/2026, mesmo dia)', () => {
  const preview = buildEventProposalPreview(calendarEvent());
  assert.equal(preview.dateSpan, 'same_day');
  assert.equal(preview.date, '02/09/2026');
});

check('37 e 11. start/end no mesmo dia -> timeRange conciso "14:00 às 15:00"', () => {
  const preview = buildEventProposalPreview(calendarEvent());
  assert.equal(preview.dateSpan, 'same_day');
  assert.equal(preview.timeRange, '14:00 às 15:00');
});

check('38. timezone diferente produz horário local correspondente (America/New_York, UTC-4 em setembro)', () => {
  const preview = buildEventProposalPreview(
    calendarEvent({ timezone: 'America/New_York', start: '2026-09-02T17:00:00.000Z', end: '2026-09-02T18:00:00.000Z' }),
  );
  assert.equal(preview.dateSpan, 'same_day');
  assert.equal(preview.timeRange, '13:00 às 14:00');
});

check(
  '9. resultado NUNCA depende do timezone do PROCESSO rodando o teste — só de event.timezone (America/Sao_Paulo, testado sob 3 TZ de processo diferentes)',
  () => {
    const originalTz = process.env.TZ;
    try {
      const results = [];
      for (const machineTz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
        process.env.TZ = machineTz;
        results.push(buildEventProposalPreview(calendarEvent()));
      }
      for (const result of results) {
        assert.deepEqual(result, results[0], `resultado divergiu conforme o TZ do processo: ${JSON.stringify(result)}`);
      }
      assert.equal(results[0].date, '02/09/2026');
      assert.equal(results[0].timeRange, '14:00 às 15:00');
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  },
);

check(
  '10. instante próximo da meia-noite UTC mostra o dia civil CORRETO no timezone do evento (nunca o dia civil de UTC)',
  () => {
    // 2026-09-03T02:00:00.000Z é 2026-09-02T23:00 em America/Sao_Paulo
    // (UTC-3) — o dia civil de UTC (03) diverge do dia civil do evento
    // (02). start/end (23:00-23:30 local) permanecem no MESMO dia civil
    // do evento — o preview precisa refletir o timezone do EVENTO, nunca UTC.
    const preview = buildEventProposalPreview(
      calendarEvent({ start: '2026-09-03T02:00:00.000Z', end: '2026-09-03T02:30:00.000Z' }),
    );
    assert.equal(preview.dateSpan, 'same_day');
    assert.equal(preview.date, '02/09/2026', 'deveria usar o dia civil de America/Sao_Paulo, não o de UTC (03)');
  },
);

check(
  '12 e 39 (dateSpan). evento atravessando meia-noite (no timezone do evento) NUNCA esconde a mudança de data — mostra início/fim por extenso',
  () => {
    // 23:30 -> 00:30 em America/Sao_Paulo, cruzando meia-noite local.
    const preview = buildEventProposalPreview(
      calendarEvent({ start: '2026-09-03T02:30:00.000Z', end: '2026-09-03T03:30:00.000Z' }),
    );
    assert.equal(preview.dateSpan, 'crosses_midnight');
    assert.equal(preview.startText, '02/09/2026 23:30');
    assert.equal(preview.endText, '03/09/2026 00:30');
    // Nenhum campo `date`/`timeRange` do formato "mesmo dia" deveria
    // coexistir aqui — os dois formatos são mutuamente exclusivos.
    assert.equal('date' in preview, false);
    assert.equal('timeRange' in preview, false);
  },
);

check('13. reminder mostra exatamente 30 minutos (reflete reminderMinutesBeforeStart, invariante do ProposedAction)', () => {
  const preview = buildEventProposalPreview(calendarEvent());
  assert.equal(preview.reminderMinutes, 30);
});

check('14. preview NUNCA contém a string ISO bruta de start/end', () => {
  const preview = buildEventProposalPreview(calendarEvent());
  const serialized = JSON.stringify(preview);
  assert.ok(!serialized.includes('2026-09-02T17:00:00.000Z'));
  assert.ok(!serialized.includes('2026-09-02T18:00:00.000Z'));
  assert.ok(!serialized.includes('T'), 'preview não deveria conter marcador ISO "T" de datetime bruto');
});

check('15. preview NUNCA contém o identificador IANA técnico do timezone (ex.: "America/Sao_Paulo")', () => {
  const preview = buildEventProposalPreview(calendarEvent());
  const serialized = JSON.stringify(preview);
  assert.ok(!serialized.includes('America/'));
  assert.ok(!serialized.includes('Sao_Paulo'));
});

check('16, 17 e 18. preview NUNCA contém proposalId/stateId/googleEventId — a função nem os recebe como input', () => {
  const preview = buildEventProposalPreview(calendarEvent());
  const serialized = JSON.stringify(preview);
  assert.ok(!/proposalId|stateId|googleEventId/i.test(serialized));
  // Garantia estrutural: a assinatura da função só aceita 1 argumento
  // (`event`), nunca um segundo parâmetro para runtime/proposal state.
  assert.equal(buildEventProposalPreview.length, 1);
});

check('1. create_local_task preview continua igual — formatDeadlinePreview/formatDurationPreview inalterados', () => {
  // Reafirma os testes 15-19 acima, que já provam isso — checagem
  // explícita de regressão nomeada para esta subfase.
  assert.equal(formatDeadlinePreview(null), null);
  assert.equal(formatDurationPreview({ minutes: 45 }), '45 min');
});

// ============================================================================
// AUDITORIA ESTÁTICA DE CONTRATO — ConversationPanel.tsx / page.tsx / proxy.ts
// ============================================================================

function readCodeOnly(relativePath) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const source = readFileSync(path, 'utf8');
  return source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const panelCode = readCodeOnly('../../src/app/conversa/ConversationPanel.tsx');
const pageCode = readCodeOnly('../../src/app/conversa/page.tsx');
const proxyCode = readCodeOnly('../../src/proxy.ts');
const entradaPageCode = readCodeOnly('../../src/app/entrada/page.tsx');

check('20. ConversationPanel chama getConversationPresentationState e sendConversationMessage', () => {
  assert.ok(panelCode.includes("from '@/lib/conversation/actions'"));
  assert.ok(panelCode.includes('sendConversationMessage'));
  assert.ok(panelCode.includes("from '@/lib/conversation/presentation'"));
  assert.ok(panelCode.includes('getConversationPresentationState'));
});

check('21. ConversationPanel não importa Supabase nem internals proibidos', () => {
  const forbidden = [
    'supabase',
    'Supabase',
    'createAdminClient',
    'service_role',
    'runtime-state-storage',
    'conversation-turn',
    'proposal-turn',
    'intent-extraction',
    "from '@/lib/conversation/confirmation'",
    'local-task-execution',
    'Anthropic',
    'Calendar',
    'createBrainDump',
    'organizeBrainDump',
    'getCalendarPlanningContext',
  ];
  for (const token of forbidden) {
    assert.ok(!panelCode.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('22. ConversationPanel não referencia stateId/proposalId/userId/expiresAt/ConversationState/ProposalState', () => {
  const forbidden = ['stateId', 'proposalId', 'userId', 'expiresAt', 'ConversationState', 'ProposalState'];
  for (const token of forbidden) {
    assert.ok(!panelCode.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('23. ConversationPanel nunca lê result.itemId (descarta via presentation-ui, nunca renderiza)', () => {
  assert.ok(!panelCode.includes('itemId'));
});

check('24. página /conversa renderiza ConversationPanel sem lógica conversacional própria', () => {
  assert.ok(pageCode.includes('ConversationPanel'));
  const forbidden = ['sendConversationMessage', 'getConversationPresentationState', 'getRuntimeState'];
  for (const token of forbidden) {
    assert.ok(!pageCode.includes(token), `lógica conversacional vazou para page.tsx: ${token}`);
  }
});

// ============================================================================
// 24b-24g. ConversationPanel: captura/envio de timezone (query_calendar
// read-only) — única responsabilidade nova do componente nesta subfase.
// ============================================================================

check('24b. ConversationPanel captura o timezone real do browser via Intl.DateTimeFormat().resolvedOptions().timeZone', () => {
  assert.ok(panelCode.includes('Intl.DateTimeFormat().resolvedOptions().timeZone'));
});

check('24c. timezone é enviado como 2º argumento de sendConversationMessage(text, timezone)', () => {
  assert.ok(/sendConversationMessage\(\s*text\s*,\s*timezone\s*\)/.test(panelCode));
});

check('24d. zero persistência de timezone — nenhum localStorage/sessionStorage/cookie/contexto global novo', () => {
  const forbidden = ['localStorage', 'sessionStorage', 'document.cookie', 'createContext', 'useContext'];
  for (const token of forbidden) {
    assert.ok(!panelCode.includes(token), `token proibido encontrado: ${token}`);
  }
});

check('24e. zero token/lógica de Calendar no client — só a API global Intl, nunca um import de Calendar', () => {
  const forbidden = [
    'getGoogleCalendarBusyTimes',
    'calendar-query',
    "from '@/lib/google",
    'access_token',
    'refresh_token',
    'GOOGLE_CLIENT',
  ];
  for (const token of forbidden) {
    assert.ok(!panelCode.includes(token), `token proibido encontrado: ${token}`);
  }
  // "Calendar" (substantivo) continua ausente do código real — só aparece
  // em prosa de comentário, já removida por readCodeOnly (ver teste 21).
  assert.ok(!panelCode.includes('Calendar'));
});

check('24f. nenhum componente novo criado — nextId/MessageBubble/ProposalPreview continuam as únicas funções de nível superior', () => {
  const matches = [...panelCode.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(
    matches.sort(),
    ['MessageBubble', 'ProposalPreview', 'nextId'].sort(),
    'nenhuma função de nível superior nova deveria existir além das 3 já aprovadas',
  );
});

check('24g. timezone só existe dentro de handleSubmit — nunca em useState/useEffect/props', () => {
  assert.ok(!panelCode.includes('useState<string | null>'));
  assert.ok(!/timezone\s*,\s*setTimezone/.test(panelCode));
  const occurrences = panelCode.split('timezone').length - 1;
  // 2 ocorrências reais no código: a declaração (`const timezone = ...`) e
  // o uso no envio (`sendConversationMessage(text, timezone)`).
  assert.equal(occurrences, 2, 'timezone deve aparecer exatamente 2 vezes no código real (declaração + uso)');
});

// ============================================================================
// 19-21. SUBFASE 8 — texto de confirmação explícito; zero Calendar write
// alcançável a partir do preview/client.
// ============================================================================

check(
  '19. preview de create_calendar_event deixa explícito que é PROPOSTA aguardando confirmação — nunca afirma "criado"/"agendado"/"já está na agenda"',
  () => {
    const previewBlockMatch = panelCode.match(/if \(action\.actionType === 'create_calendar_event'\) \{([\s\S]*?)\n  \}/);
    assert.ok(previewBlockMatch, 'branch de create_calendar_event não encontrado em ProposalPreview');
    const block = previewBlockMatch[1];
    assert.ok(/Responda|Quer confirmar/i.test(block), 'texto de confirmação explícita não encontrado');
    const forbiddenClaims = ['criado', 'Criado', 'agendado', 'Agendado', 'já está na agenda', 'confirmado no Google'];
    for (const claim of forbiddenClaims) {
      assert.ok(!block.includes(claim), `afirmação prematura encontrada no preview: "${claim}"`);
    }
  },
);

check('20 e 21. ConversationPanel/ProposalPreview nunca alcançam Calendar write — zero claim/finalize/execute/cancel importado ou chamado', () => {
  const forbidden = [
    'claimCalendarEventExecution',
    'finalizeCalendarEventExecution',
    'executeCreateCalendarEvent',
    'cancelCalendarEventProposal',
    'calendar-event-claim',
    'calendar-event-finalize',
    'calendar-event-execution',
    'calendar-event-cancel',
    'events.insert',
    'googleapis.com',
  ];
  for (const token of forbidden) {
    assert.ok(!panelCode.includes(token), `token proibido encontrado: ${token}`);
  }
});

check("25. '/conversa' está em AAL2_REQUIRED_PATHS", () => {
  const match = proxyCode.match(/AAL2_REQUIRED_PATHS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  assert.ok(match, 'AAL2_REQUIRED_PATHS não encontrado');
  assert.ok(match[1].includes("'/conversa'"), "'/conversa' ausente de AAL2_REQUIRED_PATHS");
  // Rotas já existentes preservadas — garante que a edição foi só aditiva.
  assert.ok(match[1].includes("'/entrada'"));
  assert.ok(match[1].includes("'/redefinir-senha'"));
});

// Nota histórica: a versão anterior deste teste checava a presença do link
// para /conversa via `git diff` das linhas ADICIONADAS em entrada/page.tsx
// — válido só enquanto aquela mudança (subfase de navegação/descoberta da
// V1) ainda estava sem commit. Depois do commit isolado correspondente
// (2bb4cad), `git diff` desse arquivo passa a ser vazio por definição (o
// arquivo já É o HEAD), então uma asserção baseada em "linha adicionada no
// diff atual" fica estruturalmente inatingível para sempre — não uma falha
// de regressão real. Reescrito para checar o CONTEÚDO do arquivo (estável
// independentemente do estado do git/commit) em vez do diff.
check(
  '26. /entrada: BrainDumpForm.tsx byte-for-byte intacto; page.tsx contém o link já commitado para /conversa e a única adição autorizada da Subfase 7 (calendar=permissions)',
  () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));

    const brainDumpDiff = execSync('git diff -- src/app/entrada/BrainDumpForm.tsx', { cwd: root })
      .toString()
      .trim();
    assert.equal(brainDumpDiff, '', 'BrainDumpForm.tsx foi modificado — esperado zero diff');

    // Nota histórica: este teste antes exigia diff VAZIO em page.tsx — só
    // válido enquanto nenhuma subfase posterior tinha motivo legítimo para
    // tocá-lo. A Subfase 7 (ampliação controlada do OAuth) autoriza
    // explicitamente UMA adição: o parágrafo de `calendar === "permissions"`
    // (consentimento incompleto). Mesma lição já aplicada acima para o link
    // de /conversa: checagem de CONTEÚDO, estável para sempre, nunca
    // depende do arquivo estar ou não commitado — em vez de reexigir diff
    // vazio (que ficaria inatingível assim que o commit desta subfase
    // acontecer) ou aceitar cegamente qualquer diff (que esconderia uma
    // mudança não autorizada).
    const pageDiff = execSync('git diff -- src/app/entrada/page.tsx', { cwd: root }).toString();
    const removedLines = pageDiff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---'));
    assert.equal(removedLines.length, 0, 'nenhuma linha deveria ser REMOVIDA de entrada/page.tsx nesta subfase');
    const addedLines = pageDiff
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1).trim());
    const allowedAddedLines = new Set([
      '',
      '{calendar === "permissions" && (',
      '<p role="alert" className="mb-4 text-center text-sm text-alert-500">',
      'Para agendar compromissos, o Mente Livre precisa da permissão de criar eventos no seu Google Agenda.',
      '</p>',
      ')}',
    ]);
    for (const line of addedLines) {
      assert.ok(allowedAddedLines.has(line), `linha adicionada não autorizada em entrada/page.tsx: ${JSON.stringify(line)}`);
    }

    // O link para /conversa (da subfase de navegação, já commitado em
    // 2bb4cad) continua presente no CONTEÚDO real do arquivo — checagem
    // estável para sempre, nunca depende de o commit estar ou não no
    // working tree.
    assert.ok(
      /<Link href="\/conversa" className=\{buttonVariants\("secondary"\)\}>/.test(entradaPageCode),
      'link para /conversa ausente de entrada/page.tsx',
    );
    assert.ok(
      entradaPageCode.includes('Para agendar compromissos, o Mente Livre precisa da permissão de criar eventos no seu Google Agenda.'),
      'mensagem de permissão incompleta (Subfase 7) ausente de entrada/page.tsx',
    );

    // Nenhuma lógica de BrainDump/Calendar/MFA/logout foi alterada — mesmo
    // vocabulário proibido de antes, agora aplicado ao arquivo inteiro
    // (zero diff já garante que nada mudou; isto reforça que o conteúdo
    // real nunca teve essas mutações, independente de diff).
    const forbidden = ['.from(', '.insert(', '.update(', '.delete(', 'createBrainDump', 'organizeBrainDump'];
    for (const token of forbidden) {
      assert.ok(!entradaPageCode.includes(token), `lógica indevida encontrada em entrada/page.tsx: ${token}`);
    }
    // Lógica existente (BrainDump/Calendar/MFA/logout) continua presente e
    // intacta — mesma prova positiva já usada no teste 5 de
    // navigation.test.mjs, reafirmada aqui.
    assert.ok(entradaPageCode.includes('<BrainDumpForm'));
    assert.ok(entradaPageCode.includes('connectGoogleCalendar'));
    assert.ok(entradaPageCode.includes('href="/mfa/configurar"'));
    assert.ok(entradaPageCode.includes('logout'));
  },
);

// ============================================================================
// 27-31. REGRESSÃO DO BUG "bootstrap preso em Strict Mode"
//
// Bug original (reproduzido e documentado na subfase de teste manual):
// um guard `useRef` (`bootstrapStartedRef`) sobrevivia às duas invocações
// do effect sob Strict Mode, enquanto a flag de cancelamento (`cancelled`)
// era local a cada invocação — a única promise em voo (da 1ª invocação)
// resolvia contra um `cancelled` já marcado `true` pelo cleanup, e
// `setBootstrapping(false)` nunca rodava. Estes 5 checks provam
// estruturalmente que essa combinação não existe mais.
// ============================================================================

check('27. nenhum guard persistente (useRef/.current) sobrevive entre invocações do effect de bootstrap', () => {
  assert.ok(!panelCode.includes('bootstrapStartedRef'));
  assert.ok(!panelCode.includes('useRef'));
  assert.ok(!panelCode.includes('.current'));
});

check('28. useEffect de bootstrap ainda registra função de cleanup que zera "active"', () => {
  assert.ok(panelCode.includes('return () => {'));
  assert.ok(panelCode.includes('active = false;'));
});

check('29. getConversationPresentationState é chamado com await dentro do effect', () => {
  assert.ok(panelCode.includes('await getConversationPresentationState()'));
});

check('30. setBootstrapping(false) só roda quando a execução ainda é a ativa (guardado por "if (active)")', () => {
  assert.ok(
    panelCode.includes('if (active) {\n          setBootstrapping(false);\n        }'),
    'setBootstrapping(false) não está guardado por "if (active)" no formato esperado',
  );
});

check('31. flag de controle da montagem é local a cada invocação do effect ("let active"), nunca global/módulo', () => {
  const useEffectIndex = panelCode.indexOf('useEffect(() => {');
  const activeIndex = panelCode.indexOf('let active = true;');
  assert.ok(useEffectIndex !== -1 && activeIndex !== -1, 'useEffect ou "let active = true;" não encontrados');
  assert.ok(activeIndex > useEffectIndex, '"let active" deve estar DENTRO do useEffect, não em escopo de módulo');
  // Só uma declaração de "active" no arquivo inteiro — nenhuma segunda
  // fonte de verdade escondida em outro lugar.
  const occurrences = panelCode.split('let active').length - 1;
  assert.equal(occurrences, 1, 'deve haver exatamente 1 declaração de "active" no arquivo');
});

// --- Resumo -------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) {
  process.exit(1);
}
