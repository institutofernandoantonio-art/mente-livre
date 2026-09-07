import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/app/conversa/ConversationPanel.tsx', import.meta.url), 'utf8');

const checks = [
  ['mantém referência do histórico', source.includes('const logRef = useRef<HTMLDivElement | null>(null)')],
  ['mantém referência da resposta mais recente', source.includes('const latestAssistantRef = useRef<HTMLDivElement | null>(null)')],
  ['rola o histórico interno para o final', source.includes("log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' })")],
  ['traz a resposta nova para a área visível', source.includes("scrollIntoView({ behavior: 'smooth', block: 'center' })")],
  ['destaca apenas a resposta mais recente do assistente', source.includes("message.role === 'assistant' && message.id === latestAssistantId")],
  ['identifica visualmente a resposta como Mente Livre', source.includes('>Mente Livre</p>')],
];

let failed = 0;
for (const [name, pass] of checks) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (!pass) failed += 1;
}

assert.equal(failed, 0);
console.log(`\n${checks.length} verificações passaram.`);
