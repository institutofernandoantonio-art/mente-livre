import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/app/conversa/ConversationPanel.tsx', import.meta.url), 'utf8');

const checks = [
  ['mantém elemento do histórico em estado visual', source.includes('const [logElement, setLogElement] = useState<HTMLDivElement | null>(null)')],
  ['mantém elemento da resposta mais recente em estado visual', source.includes('const [latestAssistantElement, setLatestAssistantElement] = useState<HTMLDivElement | null>(null)')],
  ['rola o histórico interno para o final', source.includes("logElement.scrollTo({ top: logElement.scrollHeight, behavior: 'smooth' })")],
  ['traz a resposta nova para a área visível', source.includes("scrollIntoView({ behavior: 'smooth', block: 'center' })")],
  ['destaca apenas a resposta mais recente do assistente', source.includes("message.role === 'assistant' && message.id === latestAssistantId")],
  ['identifica visualmente a resposta como Mente Livre', source.includes('>Mente Livre</p>')],
  ['não reintroduz useRef no bootstrap', !source.includes('useRef') && !source.includes('bootstrapStartedRef')],
];

let failed = 0;
for (const [name, pass] of checks) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (!pass) failed += 1;
}

assert.equal(failed, 0);
console.log(`\n${checks.length} verificações passaram.`);
