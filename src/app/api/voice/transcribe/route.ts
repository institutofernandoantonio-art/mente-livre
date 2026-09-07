import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  VOICE_MAX_AUDIO_BYTES,
  VOICE_MAX_DURATION_MS,
  estimateVoiceCostMicrousd,
} from '@/lib/voice/limits';
import { isVoiceSttProviderError } from '@/lib/voice/openai-stt-provider';
import { getSpeechToTextProvider, isServerVoiceSttEnabled } from '@/lib/voice/stt';
import { finalizeVoiceUsage, getVoiceUsageSummary, reserveVoiceUsage } from '@/lib/voice/usage';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

function audioExtension(type: string): string | null {
  switch (type.split(';', 1)[0].toLowerCase()) {
    case 'audio/webm':
      return 'webm';
    case 'audio/mp4':
      return 'mp4';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/m4a':
    case 'audio/x-m4a':
      return 'm4a';
    default:
      return null;
  }
}

function errorResponse(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status, headers: NO_STORE_HEADERS });
}

function providerErrorResponse(error: unknown) {
  if (!isVoiceSttProviderError(error)) {
    return errorResponse('Falha interna ao processar a resposta da transcrição.', 502, 'provider_internal');
  }

  switch (error.category) {
    case 'unauthorized':
      return errorResponse(
        'A chave de transcrição foi recusada pela OpenAI (HTTP 401).',
        502,
        'provider_unauthorized',
      );
    case 'billing':
      return errorResponse(
        'A OpenAI recusou a chamada por configuração de cobrança ou crédito do projeto (HTTP 402).',
        502,
        'provider_billing',
      );
    case 'forbidden':
      return errorResponse(
        'A chave de transcrição não tem permissão para esta chamada na OpenAI (HTTP 403).',
        502,
        'provider_forbidden',
      );
    case 'model_unavailable':
      return errorResponse(
        'O modelo ou endpoint de transcrição não está disponível para este projeto (HTTP 404).',
        502,
        'provider_model_unavailable',
      );
    case 'rate_limited':
      return errorResponse(
        'A OpenAI bloqueou a chamada por limite de uso ou cota do projeto (HTTP 429).',
        502,
        'provider_rate_limited',
      );
    case 'bad_request':
      return errorResponse(
        `A OpenAI recusou o formato ou os parâmetros do áudio${error.httpStatus ? ` (HTTP ${error.httpStatus})` : ''}.`,
        502,
        'provider_bad_request',
      );
    case 'unavailable':
      return errorResponse(
        `O serviço de transcrição da OpenAI está temporariamente indisponível${error.httpStatus ? ` (HTTP ${error.httpStatus})` : ''}.`,
        502,
        'provider_unavailable',
      );
    case 'timeout':
      return errorResponse(
        'A chamada para transcrição excedeu o tempo máximo de 25 segundos.',
        502,
        'provider_timeout',
      );
    case 'network':
      return errorResponse(
        'O servidor do Mente Livre não conseguiu conectar ao serviço de transcrição da OpenAI.',
        502,
        'provider_network',
      );
    case 'invalid_response':
      return errorResponse(
        'A OpenAI respondeu à transcrição, mas em um formato inesperado.',
        502,
        'provider_invalid_response',
      );
    case 'empty_transcript':
      return errorResponse(
        'A OpenAI recebeu o áudio, mas devolveu uma transcrição vazia.',
        502,
        'provider_empty_transcript',
      );
    case 'http_error':
      return errorResponse(
        `A OpenAI recusou a chamada de transcrição${error.httpStatus ? ` (HTTP ${error.httpStatus})` : ''}.`,
        502,
        'provider_http_error',
      );
    default:
      return errorResponse('Falha interna ao processar a resposta da transcrição.', 502, 'provider_internal');
  }
}

export async function POST(request: Request) {
  if (!isServerVoiceSttEnabled()) {
    return errorResponse('A transcrição por voz ainda não está habilitada.', 503, 'voice_disabled');
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return errorResponse('Sua sessão expirou. Entre novamente.', 401, 'unauthenticated');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse('Não consegui ler o áudio enviado.', 400, 'invalid_form');
  }

  const requestId = form.get('request_id');
  const durationRaw = form.get('duration_ms');
  const audio = form.get('audio');

  if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) {
    return errorResponse('Não consegui validar esta gravação.', 400, 'invalid_request_id');
  }

  const durationMs = typeof durationRaw === 'string' ? Number(durationRaw) : Number.NaN;
  if (!Number.isInteger(durationMs) || durationMs < 250 || durationMs > VOICE_MAX_DURATION_MS) {
    return errorResponse('O áudio precisa ter no máximo 20 segundos.', 400, 'invalid_duration');
  }

  if (!(audio instanceof File) || audio.size <= 0 || audio.size > VOICE_MAX_AUDIO_BYTES) {
    return errorResponse('O arquivo de áudio é inválido ou excede o limite do MVP.', 400, 'invalid_audio');
  }

  const extension = audioExtension(audio.type);
  if (extension === null) {
    return errorResponse('Este formato de áudio não é compatível.', 415, 'unsupported_audio');
  }

  let provider;
  try {
    provider = getSpeechToTextProvider();
  } catch {
    return errorResponse('A transcrição por voz ainda não está configurada.', 503, 'provider_unavailable');
  }

  // A reserva financeira aceita somente request_id. Provider, modelo, preço
  // e valor reservado ficam fixos na função privilegiada do banco, portanto
  // não podem ser escolhidos pelo browser nem por esta rota.
  const reservation = await reserveVoiceUsage({ requestId });

  if (reservation.status !== 'reserved') {
    switch (reservation.status) {
      case 'duplicate':
        return errorResponse('Esta gravação já foi processada. Grave novamente se necessário.', 409, 'duplicate');
      case 'rate_limited':
        return errorResponse('Muitas tentativas em sequência. Aguarde um instante e tente novamente.', 429, 'rate_limited');
      case 'budget_exceeded':
        return errorResponse('O limite mensal de voz do Mente Livre foi atingido.', 429, 'budget_exceeded');
      case 'unauthenticated':
        return errorResponse('Sua sessão expirou. Entre novamente.', 401, 'unauthenticated');
      case 'invalid':
        return errorResponse('Não consegui validar esta gravação.', 400, 'invalid_reservation');
      default:
        return errorResponse('Não consegui reservar o orçamento da transcrição.', 503, 'reservation_error');
    }
  }

  // Recria o File com nome/extensão controlados. O áudio permanece apenas
  // na memória desta requisição; não é escrito em disco/Supabase/log.
  const safeAudio = new File([audio], `voice.${extension}`, { type: audio.type });
  const estimatedCostMicrousd = estimateVoiceCostMicrousd(durationMs);

  try {
    const result = await provider.transcribe({ audio: safeAudio, language: 'pt' });
    await finalizeVoiceUsage({
      requestId,
      status: 'completed',
      durationMs,
      estimatedCostMicrousd,
    });

    const usage = await getVoiceUsageSummary();
    return NextResponse.json({ text: result.text, usage }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    // Reserva permanece contabilizada de forma conservadora no teto mensal,
    // mesmo quando o provedor falha. Isso evita retries ilimitados que
    // eventualmente possam gerar cobrança sem registro confiável.
    await finalizeVoiceUsage({
      requestId,
      status: 'failed',
      durationMs,
      estimatedCostMicrousd: 0,
    });
    return providerErrorResponse(error);
  }
}
