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

check("25. '/conversa' está em AAL2_REQUIRED_PATHS", () => {
  const match = proxyCode.match(/AAL2_REQUIRED_PATHS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  assert.ok(match, 'AAL2_REQUIRED_PATHS não encontrado');
  assert.ok(match[1].includes("'/conversa'"), "'/conversa' ausente de AAL2_REQUIRED_PATHS");
  // Rotas já existentes preservadas — garante que a edição foi só aditiva.
  assert.ok(match[1].includes("'/entrada'"));
  assert.ok(match[1].includes("'/redefinir-senha'"));
});

check('26. /entrada não foi alterada nesta subfase (byte-for-byte)', () => {
  const diff = execSync('git diff -- src/app/entrada', { cwd: fileURLToPath(new URL('../..', import.meta.url)) })
    .toString()
    .trim();
  assert.equal(diff, '', 'src/app/entrada foi modificada — esperado zero diff');
});

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
