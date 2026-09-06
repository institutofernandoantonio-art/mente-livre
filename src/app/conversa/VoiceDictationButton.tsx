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
      return 'Permita o uso do microfone para falar com o Mente Livre.';
    case 'no-speech':
      return 'Não ouvi nenhuma fala. Tente novamente.';
    case 'audio-capture':
      return 'Não consegui acessar o microfone deste aparelho.';
    default:
      return 'Não consegui reconhecer sua fala agora. Tente novamente.';
  }
}

export function VoiceDictationButton({ disabled, onTranscript }: VoiceDictationButtonProps) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const startWatchdogRef = useRef<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const supported = useSyncExternalStore(
    subscribeToSpeechSupport,
    getSpeechSupportSnapshot,
    getServerSpeechSupportSnapshot,
  );

  useEffect(() => {
    return () => {
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

  function startListening() {
    if (disabled || listening || starting) return;

    const Recognition = getSpeechRecognitionConstructor();
    if (Recognition === null) return;

    const recognition = new Recognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    setMessage(null);
    setStarting(true);

    recognition.onstart = () => {
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
      clearStartWatchdog();
      setStarting(false);
      setListening(false);
      const nextMessage = voiceErrorMessage(event.error);
      if (nextMessage !== null) setMessage(nextMessage);
    };

    recognition.onend = () => {
      clearStartWatchdog();
      setStarting(false);
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    startWatchdogRef.current = window.setTimeout(() => {
      if (recognitionRef.current !== recognition) return;
      recognition.abort();
      recognitionRef.current = null;
      startWatchdogRef.current = null;
      setStarting(false);
      setListening(false);
      setMessage('O microfone não respondeu neste navegador. Tente novamente ou use o ditado do teclado.');
    }, START_WATCHDOG_MS);

    try {
      recognition.start();
    } catch {
      clearStartWatchdog();
      recognitionRef.current = null;
      setStarting(false);
      setListening(false);
      setMessage('Não consegui iniciar o microfone. Tente novamente.');
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
          ? 'Abrindo microfone...'
          : listening
            ? 'Ouvindo... fale naturalmente.'
            : message ?? 'A fala vira texto para você revisar antes de enviar.'}
      </p>
      <p className="text-[11px] leading-relaxed text-ink-soft">
        O reconhecimento de voz usa o recurso disponível no seu navegador ou aparelho. O Mente Livre não envia nem armazena áudio bruto nesta etapa.
      </p>
    </div>
  );
}
