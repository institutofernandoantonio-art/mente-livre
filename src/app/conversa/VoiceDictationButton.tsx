'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { VOICE_MAX_AUDIO_BYTES, VOICE_MAX_DURATION_MS } from '@/lib/voice/limits';

type VoiceDictationButtonProps = {
  disabled: boolean;
  onTranscript: (transcript: string) => void;
};

type VoiceUsageSummary = {
  calls: number;
  minutes: number;
  estimatedCostUsd: number;
  reservedBudgetUsd: number;
  internalLimitUsd: number;
};

type VoiceApiPayload = {
  text?: unknown;
  usage?: VoiceUsageSummary | null;
  error?: unknown;
  code?: unknown;
};

type VoiceState = 'idle' | 'requesting' | 'recording' | 'transcribing';

const AUTO_STOP_MS = VOICE_MAX_DURATION_MS - 500;

function requestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function preferredMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }

  for (const candidate of [
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }

  return undefined;
}

function extensionForMime(type: string): string {
  const base = type.split(';', 1)[0].toLowerCase();
  if (base === 'audio/mp4') return 'mp4';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mpeg') return 'mp3';
  if (base === 'audio/wav' || base === 'audio/x-wav') return 'wav';
  if (base === 'audio/m4a' || base === 'audio/x-m4a') return 'm4a';
  return 'webm';
}

function formatUsd(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: 4,
  });
}

async function fetchVoiceUsageSummary(): Promise<VoiceUsageSummary | null> {
  try {
    const response = await fetch('/api/voice/usage', { cache: 'no-store' });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'usage' in payload &&
      typeof payload.usage === 'object' &&
      payload.usage !== null
    ) {
      return payload.usage as VoiceUsageSummary;
    }
  } catch {
    // O resumo é informativo; falha nele nunca bloqueia a conversa.
  }
  return null;
}

export function VoiceDictationButton({ disabled, onTranscript }: VoiceDictationButtonProps) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const currentRequestIdRef = useRef<string | null>(null);
  const recordingFailedRef = useRef(false);
  const recordingCancelledRef = useRef(false);
  const autoStopRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const [state, setState] = useState<VoiceState>('idle');
  const [message, setMessage] = useState<string>('A fala vira texto para você revisar antes de enviar.');
  const [usage, setUsage] = useState<VoiceUsageSummary | null>(null);
  const [inputLabel, setInputLabel] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    async function loadUsage() {
      const latestUsage = await fetchVoiceUsageSummary();
      if (mountedRef.current && latestUsage) setUsage(latestUsage);
    }

    void loadUsage();

    return () => {
      mountedRef.current = false;
      if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      streamRef.current = null;
    };
  }, []);

  function releaseCapture() {
    if (autoStopRef.current !== null) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  async function transcribe(blob: Blob, durationMs: number, id: string) {
    if (!mountedRef.current) return;
    setState('transcribing');
    setMessage('Transcrevendo com segurança...');

    const type = blob.type || 'audio/webm';
    const form = new FormData();
    form.append('request_id', id);
    form.append('duration_ms', String(durationMs));
    form.append('audio', blob, `voice.${extensionForMime(type)}`);

    let usageReturnedByTranscription = false;

    try {
      const response = await fetch('/api/voice/transcribe', {
        method: 'POST',
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as VoiceApiPayload;

      if (!response.ok) {
        const error = typeof payload.error === 'string'
          ? payload.error
          : 'Não consegui transcrever sua fala agora. Tente novamente.';
        if (mountedRef.current) setMessage(error);
        return;
      }

      if (typeof payload.text !== 'string' || payload.text.trim().length === 0) {
        if (mountedRef.current) setMessage('A transcrição voltou vazia. Tente novamente.');
        return;
      }

      if (mountedRef.current) {
        onTranscript(payload.text.slice(0, 10_000));
        if (payload.usage) {
          setUsage(payload.usage);
          usageReturnedByTranscription = true;
        }
        setMessage('Texto reconhecido. Revise antes de enviar.');
      }
    } catch {
      if (mountedRef.current) {
        setMessage('Não consegui enviar o áudio para transcrição. Confira sua conexão e tente novamente.');
      }
    } finally {
      if (!usageReturnedByTranscription) {
        const latestUsage = await fetchVoiceUsageSummary();
        if (mountedRef.current && latestUsage) setUsage(latestUsage);
      }
      if (mountedRef.current) setState('idle');
    }
  }

  async function startRecording() {
    if (disabled || state !== 'idle') return;

    if (typeof window === 'undefined' || !window.isSecureContext) {
      setMessage('O microfone só pode ser usado em uma conexão segura (HTTPS).');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMessage('Este navegador não oferece a captura de áudio necessária. Atualize o navegador e tente novamente.');
      return;
    }

    setState('requesting');
    setMessage('Pedindo acesso ao microfone...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const audioTrack = stream.getAudioTracks()[0];
      setInputLabel(audioTrack?.label.trim() || 'Microfone do dispositivo');

      const mimeType = preferredMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      chunksRef.current = chunks;
      streamRef.current = stream;
      recorderRef.current = recorder;
      currentRequestIdRef.current = requestId();
      recordingFailedRef.current = false;
      recordingCancelledRef.current = false;
      recordingStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onerror = () => {
        recordingFailedRef.current = true;
        recordingCancelledRef.current = false;
        currentRequestIdRef.current = null;
        releaseCapture();
        if (mountedRef.current) {
          setState('idle');
          setMessage('O navegador interrompeu a gravação. Tente novamente.');
        }
      };

      recorder.onstop = () => {
        const failed = recordingFailedRef.current;
        const cancelled = recordingCancelledRef.current;
        recordingFailedRef.current = false;
        recordingCancelledRef.current = false;
        const elapsed = Date.now() - recordingStartedAtRef.current;
        const durationMs = Math.max(250, Math.min(VOICE_MAX_DURATION_MS, elapsed));
        const id = currentRequestIdRef.current;
        const type = recorder.mimeType || chunks[0]?.type || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        releaseCapture();

        if (failed) return;
        if (cancelled) {
          if (mountedRef.current) {
            setState('idle');
            setMessage('Gravação cancelada. Nenhum áudio foi enviado para transcrição.');
          }
          return;
        }

        if (!id || blob.size === 0) {
          if (mountedRef.current) {
            setState('idle');
            setMessage('Não recebi áudio desta gravação. Tente novamente.');
          }
          return;
        }

        if (blob.size > VOICE_MAX_AUDIO_BYTES) {
          if (mountedRef.current) {
            setState('idle');
            setMessage('O áudio excedeu o limite do MVP. Grave uma mensagem mais curta.');
          }
          return;
        }

        void transcribe(blob, durationMs, id);
      };

      recorder.start();
      setState('recording');
      setMessage('Ouvindo... fale naturalmente. Máximo de 20 segundos.');
      autoStopRef.current = window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, AUTO_STOP_MS);
    } catch (error) {
      releaseCapture();
      setState('idle');
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        setMessage('O microfone está bloqueado para este site. Libere a permissão do microfone e tente novamente.');
      } else {
        setMessage('Não consegui abrir o microfone neste aparelho. Tente novamente.');
      }
    }
  }

  function stopRecording() {
    if (state !== 'recording') return;
    setMessage('Finalizando áudio...');
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  function cancelRecording() {
    if (state !== 'recording') return;
    recordingCancelledRef.current = true;
    currentRequestIdRef.current = null;
    setMessage('Cancelando gravação...');

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }

    releaseCapture();
    recordingCancelledRef.current = false;
    setState('idle');
    setMessage('Gravação cancelada. Nenhum áudio foi enviado para transcrição.');
  }

  const buttonLabel = state === 'requesting'
    ? 'Abrindo microfone...'
    : state === 'recording'
      ? 'Parar e transcrever'
      : state === 'transcribing'
        ? 'Transcrevendo...'
        : 'Falar';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || state === 'requesting' || state === 'transcribing'}
          onClick={state === 'recording' ? stopRecording : startRecording}
          className="min-w-0 flex-1"
          aria-pressed={state === 'recording'}
        >
          <span aria-hidden="true" className="text-base leading-none">🎙️</span>
          {buttonLabel}
        </Button>

        {state === 'recording' && (
          <Button type="button" variant="ghost" onClick={cancelRecording} className="shrink-0 px-4">
            Cancelar
          </Button>
        )}
      </div>

      <p aria-live="polite" className="text-xs text-ink-soft">{message}</p>

      {inputLabel && (
        <p className="text-[11px] leading-relaxed text-ink-soft">
          {state === 'recording' || state === 'transcribing' ? 'Microfone em uso' : 'Último microfone usado'}: {inputLabel}.
        </p>
      )}

      <details className="text-[11px] text-ink-soft">
        <summary className="cursor-pointer select-none">Uso e privacidade da voz</summary>
        {usage && (
          <p className="mt-2 leading-relaxed">
            Voz neste mês: {usage.minutes.toLocaleString('pt-BR')} min · ~{formatUsd(usage.estimatedCostUsd)} · proteção de orçamento {formatUsd(usage.reservedBudgetUsd)} / {formatUsd(usage.internalLimitUsd)}.
          </p>
        )}
        <p className="mt-2 leading-relaxed">
          Ao tocar em Falar, o Mente Livre captura no máximo 20 segundos e envia o áudio temporariamente por HTTPS para transcrição. O áudio bruto não é salvo no Supabase nem em logs; só o texto volta para você revisar antes de Enviar.
        </p>
      </details>
    </div>
  );
}
