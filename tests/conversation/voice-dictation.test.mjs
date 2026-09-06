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

check('voz não grava nem envia áudio pelo código do Mente Livre', () => {
  for (const forbidden of ['MediaRecorder', 'FormData', 'fetch(', 'localStorage', 'sessionStorage']) {
    assert.ok(!voiceSource.includes(forbidden), `capacidade proibida nesta fatia: ${forbidden}`);
  }
});

check('preflight solicita permissão local e encerra o stream imediatamente', () => {
  assert.match(voiceSource, /navigator\.mediaDevices/);
  assert.match(voiceSource, /mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(voiceSource, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(voiceSource, /NotAllowedError/);
  assert.match(voiceSource, /SecurityError/);
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

check('microfone e reconhecimento só começam por ação explícita no botão', () => {
  assert.match(voiceSource, /onClick=\{active \? stopListening : startListening\}/);
  const handlerIndex = voiceSource.indexOf('async function startListening()');
  const permissionIndex = voiceSource.indexOf('requestMicrophonePermission()');
  const startIndex = voiceSource.indexOf('recognition.start()');
  assert.ok(handlerIndex >= 0, 'handler startListening precisa existir');
  assert.ok(permissionIndex > handlerIndex, 'permissão só pode ser pedida dentro/depois do handler de gesto explícito');
  assert.ok(startIndex > permissionIndex, 'recognition.start() só pode vir depois do preflight de permissão');
});

check('mostra feedback imediato durante permissão e abertura do reconhecimento', () => {
  assert.match(voiceSource, /const \[starting, setStarting\] = useState\(false\)/);
  assert.match(voiceSource, /setStarting\(true\)/);
  assert.match(voiceSource, /Pedindo acesso ao microfone\.\.\./);
  assert.match(voiceSource, /Abrindo reconhecimento de voz\.\.\./);
  assert.match(voiceSource, /starting \? 'Cancelar'/);
});

check('impede starts concorrentes e invalida tentativa cancelada', () => {
  assert.match(voiceSource, /disabled \|\| listening \|\| starting/);
  assert.match(voiceSource, /const active = starting \|\| listening/);
  assert.match(voiceSource, /startAttemptRef\.current \+= 1/);
  assert.match(voiceSource, /startAttemptRef\.current !== attempt/);
});

check('watchdog libera a UI quando o reconhecimento não devolve callbacks', () => {
  assert.match(voiceSource, /const START_WATCHDOG_MS = 8000/);
  assert.match(voiceSource, /window\.setTimeout/);
  assert.match(voiceSource, /recognition\.abort\(\)/);
  assert.match(voiceSource, /o reconhecimento de voz deste navegador não respondeu/i);
  assert.match(voiceSource, /clearStartWatchdog\(\)/);
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
