import 'server-only';
import type { SpeechToTextProvider, TranscriptionRequest, TranscriptionResult } from './stt-provider';

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_STT_MODEL = 'gpt-transcribe';
const REQUEST_TIMEOUT_MS = 25_000;

function getApiKey(): string {
  const key = process.env.MENTE_LIVRE_OPENAI_STT_API_KEY;
  if (!key) {
    throw new Error('Voice transcription provider is not configured.');
  }
  return key;
}

export class OpenAISttProvider implements SpeechToTextProvider {
  readonly provider = 'openai';
  readonly model = OPENAI_STT_MODEL;

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const form = new FormData();
      form.append('file', request.audio, request.audio.name || 'voice.webm');
      form.append('model', this.model);
      if (request.language) {
        form.append('language', request.language);
      }

      const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
        },
        body: form,
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!response.ok) {
        // Nunca incluir corpo da resposta ou chave em erro/log. O chamador
        // devolve mensagem genérica e finaliza a reserva como failed.
        throw new Error('Voice transcription provider request failed.');
      }

      const payload: unknown = await response.json();
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('text' in payload) ||
        typeof payload.text !== 'string'
      ) {
        throw new Error('Voice transcription provider returned an invalid response.');
      }

      const text = payload.text.trim();
      if (text.length === 0 || text.length > 10_000) {
        throw new Error('Voice transcription provider returned invalid text.');
      }

      return { text };
    } finally {
      clearTimeout(timeout);
    }
  }
}
