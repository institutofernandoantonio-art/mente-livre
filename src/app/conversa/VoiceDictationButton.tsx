'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/Button';

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionResultListLike = {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
};

type SpeechRecognitionEventLike = Event & {
  results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorEventLike = Event & {
  error: string;
};

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type VoiceDictationButtonProps = {
  disabled: boolean;
  onTranscript: (transcript: string) => void;
};

type MicrophonePermissionResult = 'granted' | 'unavailable' | 'denied' | 'error';

const START_WATCHDOG_MS = 8000;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;

  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function subscribeToSpeechSupport(): () => void {
  // A disponibilidade desta API não muda durante a vida da página.
  // useSyncExternalStore é usado só para ter um snapshot client/server
  // consistente sem setState síncrono em useEffect.
  return () => undefined;
}

function getSpeechSupportSnapshot(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

function getServerSpeechSupportSnapshot(): boolean {
  return false;
}

function voiceErrorMessage(error: string): string | null {
  switch (error) {
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'O navegador bloqueou o microfone. Permita o acesso para este site e tente novamente.';
    case 'no-speech':
      return 'Não ouvi nenhuma fala. Tente novamente.';
    case 'audio-capture':
      return 'Não consegui acessar o microfone deste aparelho.';
    default:
      return 'Não consegui reconhecer sua fala agora. Tente novamente.';
  }
}

function isMicrophonePermissionDenied(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
}

async function requestMicrophonePermission(): Promise<MicrophonePermissionResult> {
  if (typeof navigator === 'undefined') return 'unavailable';

  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) return 'unavailable';

  try {
    // Pré-voo de permissão para iOS/Safari: solicita o microfone somente por
    // gesto explícito. O stream não é lido, gravado ou enviado; todas as
    // tracks são encerradas imediatamente antes do SpeechRecognition.
    const stream = await mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return 'granted';
  } catch (error) {
    if (isMicrophonePermissionDenied(error)) return 'denied';
    return 'error';
  }
}

export function VoiceDictationButton({ disabled, onTranscript }: VoiceDictationButtonProps) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const startWatchdogRef = useRef<number | null>(null);
  const permissionCheckedRef = useRef(false);
  const startAttemptRef = useRef(0);
  const [starting, setStarting] = useState(false);
  const [startingMessage, setStartingMessage] = useState('Abrindo microfone...');
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const supported = useSyncExternalStore(
    subscribeToSpeechSupport,
    getSpeechSupportSnapshot,
    getServerSpeechSupportSnapshot,
  );

  useEffect(() => {
    return () => {
      startAttemptRef.current += 1;
      if (startWatchdogRef.current !== null) {
        window.clearTimeout(startWatchdogRef.current);
        startWatchdogRef.current = null;
      }
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  function clearStartWatchdog() {
    if (startWatchdogRef.current === null) return;
    window.clearTimeout(startWatchdogRef.current);
    startWatchdogRef.current = null;
  }

  function stopListening() {
    startAttemptRef.current += 1;
    clearStartWatchdog();
    if (starting) {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      setStarting(false);
      setListening(false);
      setMessage('Microfone cancelado. Toque em Falar para tentar novamente.');
      return;
    }
    recognitionRef.current?.stop();
  }

  async function startListening() {
    if (disabled || listening || starting) return;

    const Recognition = getSpeechRecognitionConstructor();
    if (Recognition === null) return;

    const attempt = startAttemptRef.current + 1;
    startAttemptRef.current = attempt;
    setMessage(null);
    setStarting(true);

    if (!permissionCheckedRef.current) {
      setStartingMessage('Pedindo acesso ao microfone...');
      const permissionResult = await requestMicrophonePermission();
      if (startAttemptRef.current !== attempt) return;

      if (permissionResult === 'denied') {
        setStarting(false);
        setMessage('O microfone está bloqueado para este site. Libere a permissão no navegador e tente novamente.');
        return;
      }

      if (permissionResult === 'error') {
        setStarting(false);
        setMessage('Não consegui solicitar o microfone neste aparelho. Tente novamente.');
        return;
      }

      if (permissionResult === 'granted') {
        permissionCheckedRef.current = true;
      }
    }

    if (startAttemptRef.current !== attempt) return;
    setStartingMessage('Abrindo reconhecimento de voz...');

    const recognition = new Recognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (startAttemptRef.current !== attempt) {
        recognition.abort();
        return;
      }
      clearStartWatchdog();
      setStarting(false);
      setListening(true);
    };

    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let resultIndex = 0; resultIndex < event.results.length; resultIndex += 1) {
        const result = event.results[resultIndex];
        if (!result.isFinal || result.length === 0) continue;
        const transcript = result[0]?.transcript?.trim();
        if (transcript) parts.push(transcript);
      }

      const transcript = parts.join(' ').trim();
      if (transcript.length > 0) {
        onTranscript(transcript);
        setMessage('Texto reconhecido. Revise antes de enviar.');
      }
    };

    recognition.onerror = (event) => {
      if (startAttemptRef.current !== attempt) return;
      clearStartWatchdog();
      setStarting(false);
      setListening(false);
      const nextMessage = voiceErrorMessage(event.error);
      if (nextMessage !== null) setMessage(nextMessage);
    };

    recognition.onend = () => {
      if (startAttemptRef.current !== attempt) return;
      clearStartWatchdog();
      setStarting(false);
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    startWatchdogRef.current = window.setTimeout(() => {
      if (recognitionRef.current !== recognition || startAttemptRef.current !== attempt) return;
      recognition.abort();
      recognitionRef.current = null;
      startWatchdogRef.current = null;
      setStarting(false);
      setListening(false);
      setMessage('O microfone foi liberado, mas o reconhecimento de voz deste navegador não respondeu.');
    }, START_WATCHDOG_MS);

    try {
      recognition.start();
    } catch {
      if (startAttemptRef.current !== attempt) return;
      clearStartWatchdog();
      recognitionRef.current = null;
      setStarting(false);
      setListening(false);
      setMessage('Não consegui iniciar o reconhecimento de voz. Tente novamente.');
    }
  }

  if (!supported) return null;

  const active = starting || listening;

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={active ? stopListening : startListening}
        className="w-full"
        aria-pressed={active}
      >
        <span aria-hidden="true" className="text-base leading-none">🎙️</span>
        {starting ? 'Cancelar' : listening ? 'Parar de ouvir' : 'Falar'}
      </Button>
      <p aria-live="polite" className="text-xs text-ink-soft">
        {starting
          ? startingMessage
          : listening
            ? 'Ouvindo... fale naturalmente.'
            : message ?? 'A fala vira texto para você revisar antes de enviar.'}
      </p>
      <p className="text-[11px] leading-relaxed text-ink-soft">
        A autorização e o reconhecimento de voz ficam sob controle do navegador. O Mente Livre não grava nem envia áudio bruto nesta etapa.
      </p>
    </div>
  );
}
