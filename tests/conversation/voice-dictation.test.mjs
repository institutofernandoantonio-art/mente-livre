import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const voiceSource = readFileSync(
  fileURLToPath(new URL('../../src/app/conversa/VoiceDictationButton.tsx', import.meta.url)),
  'utf8',
);
const panelSource = readFileSync(
  fileURLToPath(new URL('../../src/app/conversa/ConversationPanel.tsx', import.meta.url)),
  'utf8',
);

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`[PASS] ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`[FAIL] ${name} — ${error.message}`);
  }
}

check('usa reconhecimento de fala progressivo do navegador em pt-BR', () => {
  assert.match(voiceSource, /SpeechRecognition/);
  assert.match(voiceSource, /webkitSpeechRecognition/);
  assert.match(voiceSource, /recognition\.lang = 'pt-BR'/);
});

check('ditado é de um turno e sem resultados intermediários', () => {
  assert.match(voiceSource, /recognition\.interimResults = false/);
  assert.match(voiceSource, /recognition\.continuous = false/);
  assert.match(voiceSource, /recognition\.maxAlternatives = 1/);
});

check('voz não envia nem grava áudio pelo código do Mente Livre', () => {
  for (const forbidden of ['MediaRecorder', 'getUserMedia', 'FormData', 'fetch(', 'localStorage', 'sessionStorage']) {
    assert.ok(!voiceSource.includes(forbidden), `capacidade proibida nesta fatia: ${forbidden}`);
  }
});

check('componente de voz não conhece o dispatcher nem ações de calendário', () => {
  assert.ok(!voiceSource.includes('sendConversationMessage'));
  assert.ok(!voiceSource.includes('sendConversation'));
  assert.ok(!voiceSource.includes('Google'));
  assert.ok(!voiceSource.includes('Supabase'));
});

check('transcript entra no textarea e não é enviado automaticamente', () => {
  assert.match(panelSource, /<VoiceDictationButton/);
  assert.match(panelSource, /onTranscript=\{handleVoiceTranscript\}/);
  assert.match(panelSource, /setText\(transcript\.slice\(0, 10000\)\)/);
  assert.ok(!voiceSource.includes('type="submit"'));
});

check('interface deixa explícita a revisão antes do envio', () => {
  assert.match(voiceSource, /Revise antes de enviar/i);
  assert.match(voiceSource, /revisar antes de enviar/i);
});

check('reconhecimento só começa por ação explícita no botão', () => {
  assert.match(voiceSource, /onClick=\{listening \? stopListening : startListening\}/);
  assert.match(voiceSource, /recognition\.start\(\)/);
  assert.ok(!/useEffect\([\s\S]*recognition\.start\(\)/.test(voiceSource));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
