import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSpokenResponse } from '../../src/lib/conversation/spoken-response.ts';

assert.equal(
  buildSpokenResponse({ role: 'assistant', kind: 'text', text: 'Você tem três compromissos hoje.' }),
  'Você tem três compromissos hoje.',
);

assert.equal(
  buildSpokenResponse({
    role: 'assistant',
    kind: 'proposal',
    action: {
      actionType: 'create_local_task',
      task: { title: 'Ligar para o contador', description: null, deadline: null, duration: null },
    },
  }),
  'Preparei a tarefa Ligar para o contador. Confira os detalhes e responda sim ou não para confirmar.',
);

assert.equal(
  buildSpokenResponse({
    role: 'assistant',
    kind: 'proposal',
    action: {
      actionType: 'create_calendar_event',
      event: {
        title: 'Ligar para o contador',
        description: null,
        start: '2026-09-08T11:00:00.000Z',
        end: '2026-09-08T12:00:00.000Z',
        timezone: 'America/Sao_Paulo',
        reminderMinutesBeforeStart: 30,
      },
    },
  }),
  'Preparei o compromisso Ligar para o contador. Confira os detalhes e responda sim ou não para confirmar.',
);

assert.equal(
  buildSpokenResponse({
    role: 'assistant',
    kind: 'schedule_suggestions',
    suggestions: [
      { day: 'tomorrow', hour: 8, label: 'Amanhã, 08:00' },
      { day: 'tomorrow', hour: 10, label: 'Amanhã, 10:00' },
    ],
  }),
  'Esse horário não está disponível. Encontrei Amanhã, 08:00 ou Amanhã, 10:00. Você pode escolher uma opção ou dizer outro horário.',
);

assert.equal(
  buildSpokenResponse({ role: 'user', kind: 'text', text: 'não deve falar' }),
  '',
);

const panel = readFileSync(new URL('../../src/app/conversa/ConversationPanel.tsx', import.meta.url), 'utf8');

assert.ok(panel.includes('const [voicePrepared, setVoicePrepared] = useState(false)'));
assert.ok(panel.includes('setVoicePrepared(true)'));
assert.ok(panel.includes('setVoicePrepared(false)'));
assert.ok(panel.includes('const shouldSpeakResponse = voicePrepared'));
assert.ok(panel.includes("'speechSynthesis' in window"));
assert.ok(panel.includes("utterance.lang = 'pt-BR'"));
assert.ok(panel.includes('window.speechSynthesis.cancel()'));
assert.ok(panel.includes('window.speechSynthesis.speak(utterance)'));
assert.ok(panel.includes('buildSpokenResponse(message)'));
assert.ok(panel.includes('setText(transcript.slice(0, 10000))'));

const voiceHandlerStart = panel.indexOf('function handleVoiceTranscript(transcript: string)');
const nextFunctionStart = panel.indexOf('function offersYesNoQuickReply', voiceHandlerStart);
assert.ok(voiceHandlerStart !== -1 && nextFunctionStart > voiceHandlerStart);
const voiceHandler = panel.slice(voiceHandlerStart, nextFunctionStart);
assert.ok(!voiceHandler.includes('submitText('));
assert.ok(!voiceHandler.includes('sendConversationMessage('));

for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'api.openai.com']) {
  assert.ok(!panel.includes(forbidden), `persistência/serviço proibido no painel: ${forbidden}`);
}

console.log('[PASS] respostas de texto, proposta e alternativas viram fala simples em português');
console.log('[PASS] fala automática só é armada após transcrição de voz e é desarmada ao editar/enviar');
console.log('[PASS] síntese usa apenas o recurso local do navegador, sem persistência ou novo provedor');
console.log('[PASS] transcrição continua exigindo revisão e envio explícito');
