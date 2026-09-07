import 'server-only';
import type { SpeechToTextProvider, TranscriptionRequest, TranscriptionResult } from './stt-provider';

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_STT_MODEL = 'gpt-transcribe';
const REQUEST_TIMEOUT_MS = 25_000;

export type VoiceSttProviderErrorCategory =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'billing'
  | 'model_unavailable'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'empty_transcript'
  | 'http_error';

export class VoiceSttProviderError extends Error {
  readonly category: VoiceSttProviderErrorCategory;
  readonly httpStatus: number | null;

  constructor(category: VoiceSttProviderErrorCategory, httpStatus: number | null = null) {
    super('Voice transcription provider request failed.');
    this.name = 'VoiceSttProviderError';
    this.category = category;
    this.httpStatus = httpStatus;
  }
}

const PROVIDER_ERROR_CATEGORIES = new Set<VoiceSttProviderErrorCategory>([
  'bad_request',
  'unauthorized',
  'forbidden',
  'billing',
  'model_unavailable',
  'rate_limited',
  'unavailable',
  'timeout',
  'network',
  'invalid_response',
  'empty_transcript',
  'http_error',
]);

export function isVoiceSttProviderError(error: unknown): error is VoiceSttProviderError {
  if (typeof error !== 'object' || error === null) return false;
  if (!('name' in error) || error.name !== 'VoiceSttProviderError') return false;
  if (!('category' in error) || typeof error.category !== 'string') return false;
  return PROVIDER_ERROR_CATEGORIES.has(error.category as VoiceSttProviderErrorCategory);
}

function categoryFromStatus(status: number): VoiceSttProviderErrorCategory {
  if (status === 400 || status === 409 || status === 413 || status === 415 || status === 422) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'billing';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'model_unavailable';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'http_error';
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

      let response: Response;
      try {
        response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getApiKey()}`,
          },
          body: form,
          signal: controller.signal,
          cache: 'no-store',
        });
      } catch {
        // Nunca propaga detalhes da exceção de rede, que podem variar por
        // runtime. Só diferencia timeout de falha de transporte.
        throw new VoiceSttProviderError(controller.signal.aborted ? 'timeout' : 'network');
      }

      if (!response.ok) {
        // Só propaga categoria + status HTTP. Nunca inclui corpo da resposta,
        // texto do usuário, áudio, request headers ou chave.
        throw new VoiceSttProviderError(categoryFromStatus(response.status), response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new VoiceSttProviderError('invalid_response', response.status);
      }

      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('text' in payload) ||
        typeof payload.text !== 'string'
      ) {
        throw new VoiceSttProviderError('invalid_response', response.status);
      }

      const text = payload.text.trim();
      if (text.length === 0) {
        throw new VoiceSttProviderError('empty_transcript', response.status);
      }
      if (text.length > 10_000) {
        throw new VoiceSttProviderError('invalid_response', response.status);
      }

      return { text };
    } finally {
      clearTimeout(timeout);
    }
  }
}
