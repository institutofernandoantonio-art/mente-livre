import 'server-only';
import type { SpeechToTextProvider, TranscriptionRequest, TranscriptionResult } from './stt-provider';

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_STT_MODEL = 'gpt-transcribe';
const REQUEST_TIMEOUT_MS = 25_000;

export type VoiceSttProviderErrorCategory =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'unavailable'
  | 'unknown';

export class VoiceSttProviderError extends Error {
  readonly category: VoiceSttProviderErrorCategory;

  constructor(category: VoiceSttProviderErrorCategory) {
    super('Voice transcription provider request failed.');
    this.name = 'VoiceSttProviderError';
    this.category = category;
  }
}

function categoryFromStatus(status: number): VoiceSttProviderErrorCategory {
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'unknown';
}

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

  constructor() {
    // Falha antes da reserva financeira quando a integração foi ligada sem a
    // chave dedicada. Assim, uma configuração incompleta não consome o teto
    // interno do mês sem sequer existir possibilidade de chamada ao provedor.
    getApiKey();
  }

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
        // Só propaga uma categoria derivada do status HTTP. Nunca inclui corpo
        // da resposta, texto do usuário, áudio, request headers ou chave.
        throw new VoiceSttProviderError(categoryFromStatus(response.status));
      }

      const payload: unknown = await response.json();
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('text' in payload) ||
        typeof payload.text !== 'string'
      ) {
        throw new VoiceSttProviderError('unknown');
      }

      const text = payload.text.trim();
      if (text.length === 0 || text.length > 10_000) {
        throw new VoiceSttProviderError('unknown');
      }

      return { text };
    } finally {
      clearTimeout(timeout);
    }
  }
}
