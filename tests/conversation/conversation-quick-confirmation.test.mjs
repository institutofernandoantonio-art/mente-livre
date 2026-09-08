import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/app/conversa/ConversationPanel.tsx', import.meta.url), 'utf8');

const checks = [
  ['propostas sempre oferecem resposta rápida', source.includes("if (message.kind === 'proposal') return true")],
  ['confirmações textuais de cancelar/remarcar também oferecem botões', source.includes('responda\\s+[“\"]sim')],
  ['botão Sim envia exatamente sim', source.includes("onQuickReply('sim')")],
  ['botão Não envia exatamente não', source.includes("onQuickReply('não')")],
  ['resposta rápida usa o mesmo pipeline conversacional', source.includes('sendConversationMessage(text, timezone)')],
  ['resposta rápida não remove voz', source.includes('<VoiceDictationButton')],
  ['botões são desabilitados durante processamento', source.includes('disabled={quickReplyDisabled}')],
  ['somente a resposta mais recente oferece confirmação rápida', source.includes('showQuickConfirmation={isLatestAssistant && offersYesNoQuickReply(message)}')],
  ['painel sabe quando a proposta está visível', source.includes("const proposalVisible = latestAssistantMessage?.kind === 'proposal'")],
  ['modo agendar não reescreve resposta enquanto proposta está visível', source.includes('scheduleTaskTitle && !proposalVisible && !alreadyExplicit && !isConfirmation')],
  ['sim com pontuação terminal é tratado como confirmação no cliente', source.includes('/^(sim|n[aã]o)\\s*[.!?,;]*$/iu')],
];

let failed = 0;
for (const [name, pass] of checks) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (!pass) failed += 1;
}

assert.equal(failed, 0);
console.log(`\n${checks.length} verificações passaram.`);
