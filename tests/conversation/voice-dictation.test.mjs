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

check('captura áudio com MediaRecorder somente após gesto e permissão explícita', () => {
  assert.match(voiceSource, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(voiceSource, /new MediaRecorder\(/);
  assert.match(voiceSource, /window\.isSecureContext/);
  assert.match(voiceSource, /onClick=\{state === 'recording' \? stopRecording : startRecording\}/);
});

check('gravação tem limite curto e libera o microfone', () => {
  assert.match(voiceSource, /VOICE_MAX_DURATION_MS/);
  assert.match(voiceSource, /AUTO_STOP_MS/);
  assert.match(voiceSource, /track\.stop\(\)/);
  assert.match(voiceSource, /Parar e transcrever/);
});

check('erro do MediaRecorder nunca vira transcrição paga de áudio parcial', () => {
  assert.match(voiceSource, /const recordingFailedRef = useRef\(false\)/);
  assert.match(voiceSource, /recorder\.onerror = \(\) => \{[\s\S]*?recordingFailedRef\.current = true;[\s\S]*?currentRequestIdRef\.current = null;/);
  assert.match(voiceSource, /recorder\.onstop = \(\) => \{[\s\S]*?const failed = recordingFailedRef\.current;[\s\S]*?if \(failed\) return;[\s\S]*?void transcribe\(blob, durationMs, id\);/);
});

check('cliente envia áudio somente ao endpoint do próprio Mente Livre', () => {
  assert.match(voiceSource, /fetch\('\/api\/voice\/transcribe'/);
  assert.match(voiceSource, /new FormData\(\)/);
  assert.match(voiceSource, /form\.append\('audio'/);
  assert.ok(!voiceSource.includes('api.openai.com'));
  assert.ok(!voiceSource.includes('MENTE_LIVRE_OPENAI_STT_API_KEY'));
});

check('proteção contra repetição usa request_id UUID por gravação', () => {
  assert.match(voiceSource, /currentRequestIdRef/);
  assert.match(voiceSource, /crypto\.randomUUID/);
  assert.match(voiceSource, /form\.append\('request_id', id\)/);
});

check('cliente nunca repete automaticamente uma chamada de transcrição', () => {
  const transcriptionFetches = voiceSource.match(/fetch\('\/api\/voice\/transcribe'/g) ?? [];
  assert.equal(transcriptionFetches.length, 1);
  assert.ok(!voiceSource.includes('setInterval('));
});

check('não persiste áudio ou transcript no navegador', () => {
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB']) {
    assert.ok(!voiceSource.includes(forbidden), `persistência proibida: ${forbidden}`);
  }
});

check('transcript entra no textarea e não é enviado automaticamente', () => {
  assert.match(panelSource, /<VoiceDictationButton/);
  assert.match(panelSource, /onTranscript=\{handleVoiceTranscript\}/);
  assert.match(panelSource, /setText\(transcript\.slice\(0, 10000\)\)/);
  assert.ok(!voiceSource.includes('type="submit"'));
});

check('permissão negada e navegador incompatível geram orientação clara', () => {
  assert.match(voiceSource, /O microfone está bloqueado para este site/);
  assert.match(voiceSource, /Este navegador não oferece a captura de áudio necessária/);
  assert.match(voiceSource, /conexão segura \(HTTPS\)/);
});

check('interface informa limite, transcrição e privacidade', () => {
  assert.match(voiceSource, /Máximo de 20 segundos/);
  assert.match(voiceSource, /Transcrevendo com segurança/);
  assert.match(voiceSource, /não é salvo no Supabase nem em logs/);
  assert.match(voiceSource, /revisar antes de Enviar/);
});

check('mostra consumo mensal e teto interno quando disponível', () => {
  assert.match(voiceSource, /\/api\/voice\/usage/);
  assert.match(voiceSource, /Voz neste mês/);
  assert.match(voiceSource, /proteção de orçamento/);
  assert.match(voiceSource, /internalLimitUsd/);
});

check('componente de voz continua separado das ações de agenda', () => {
  assert.ok(!voiceSource.includes('sendConversationMessage'));
  assert.ok(!voiceSource.includes('Google'));
  assert.ok(!voiceSource.includes('calendar'));
});

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`\n${passed} passaram, ${failed} falharam (${results.length} total)`);
if (failed > 0) process.exit(1);
