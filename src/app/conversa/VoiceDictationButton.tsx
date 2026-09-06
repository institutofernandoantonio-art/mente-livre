'use client';

import { useEffect, useRef, useState } from 'react';
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
  onspeechend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type VoiceDictationButtonProps = {
  disabled: boolean;
  onTranscript: (transcript: string) => void;
};

type MicrophonePermissionResult = 'granted' | 'unavailable' | 'denied' | 'insecure' | 'error';

const START_WATCHDOG_MS = 8000;
const LISTENING_WATCHDOG_MS = 15000;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;

  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function isIosNonSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/i.test(userAgent);
  const isAlternativeIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent);
  return isIos && isAlternativeIosBrowser;
}

function voiceErrorMessage(error: string): string | null {
  switch (error) {
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'O navegador bloqueou o reconhecimento de fala. No iPhone, abra o Mente Livre diretamente no Safari; no Mac, confira a permissão do microfone e tente novamente.';
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
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unavailable';
  if (!window.isSecureContext) return 'insecure';

  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia) return 'unavailable';

  try {
    // O acesso acontece somente após o toque explícito do usuário. Este
    // preflight confirma a permissão real do microfone antes de depender do
    // SpeechRecognition, que pode estar ausente/limitado no Safari/PWA.
    // O stream não é lido, persistido ou enviado e é encerrado imediatamente.
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
  const listeningWatchdogRef = useRef<number | null>(null);
  const permissionCheckedRef = useRef(false);
  const startAttemptRef = useRef(0);
  const transcriptSeenRef = useRef(false);
  const recognitionErrorRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [startingMessage, setStartingMessage] = useState('Abrindo microfone...');
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      startAttemptRef.current += 1;
      if (startWatchdogRef.current !== null) {
        window.clearTimeout(startWatchdogRef.current);
        startWatchdogRef.current = null;
      }
      if (listeningWatchdogRef.current !== null) {
        window.clearTimeout(listeningWatchdogRef.current);
        listeningWatchdogRef.current = null;
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

  function clearListeningWatchdog() {
    if (listeningWatchdogRef.current === null) return;
    window.clearTimeout(listeningWatchdogRef.current);
    listeningWatchdogRef.current = null;
  }

  function stopListening() {
    startAttemptRef.current += 1;
    clearStartWatchdog();
    clearListeningWatchdog();
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

    const attempt = startAttemptRef.current + 1;
    startAttemptRef.current = attempt;
    transcriptSeenRef.current = false;
    recognitionErrorRef.current = false;
    setMessage(null);
    setStarting(true);

    if (!permissionCheckedRef.current) {
      setStartingMessage('Pedindo acesso ao microfone...');
      const permissionResult = await requestMicrophonePermission();
      if (startAttemptRef.current !== attempt) return;

      if (permissionResult === 'denied') {
        setStarting(false);
        setMessage('O microfone está bloqueado para este site. Libere a permissão do microfone nas configurações do navegador e tente novamente.');
        return;
      }

      if (permissionResult === 'insecure') {
        setStarting(false);
        setMessage('O microfone só pode ser usado em uma conexão segura (HTTPS). Abra novamente o Mente Livre pelo endereço oficial.');
        return;
      }

      if (permissionResult === 'unavailable') {
        setStarting(false);
        setMessage('Este navegador não disponibilizou acesso ao microfone para o Mente Livre. No iPhone e no Mac, abra diretamente no Safari ou no app instalado e tente novamente.');
        return;
      }

      if (permissionResult === 'error') {
        setStarting(false);
        setMessage('Não consegui solicitar o microfone neste aparelho. Feche outras aplicações que possam estar usando o microfone e tente novamente.');
        return;
      }

      permissionCheckedRef.current = true;
    }

    if (startAttemptRef.current !== attempt) return;

    // Em iOS, navegadores alternativos podem expor webkitSpeechRecognition
    // sem permitir que o serviço de reconhecimento seja usado. Nessa situação
    // não iniciamos uma sessão que sabemos poder terminar em service-not-allowed.
    if (isIosNonSafariBrowser()) {
      setStarting(false);
      setMessage('No iPhone, abra este mesmo endereço diretamente no Safari para usar o botão Falar. O Chrome e outros navegadores no iOS podem liberar o microfone, mas bloquear o serviço de reconhecimento de fala.');
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (Recognition === null) {
      setStarting(false);
      setMessage('Microfone liberado, mas este navegador não disponibilizou o reconhecimento de fala. No Safari do iPhone ou Mac, confirme que Siri e Ditado estão ativados e tente novamente.');
      return;
    }

    setStartingMessage('Abrindo reconhecimento de voz...');

    const recognition = new Recognition();
    recognition.lang = 'pt-BR';
    // Resultados parciais ajudam especialmente quando o navegador demora para
    // marcar a frase como final. O campo continua sendo apenas texto revisável.
    recognition.interimResults = true;
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
      listeningWatchdogRef.current = window.setTimeout(() => {
        if (recognitionRef.current !== recognition || startAttemptRef.current !== attempt) return;
        recognition.stop();
        clearListeningWatchdog();
        if (!transcriptSeenRef.current) {
          setMessage('Não recebi transcrição deste navegador. Tente novamente falando logo após aparecer “Ouvindo...”.');
        }
      }, LISTENING_WATCHDOG_MS);
    };

    recognition.onspeechend = () => {
      if (startAttemptRef.current !== attempt) return;
      recognition.stop();
    };

    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let resultIndex = 0; resultIndex < event.results.length; resultIndex += 1) {
        const result = event.results[resultIndex];
        if (result.length === 0) continue;
        const transcript = result[0]?.transcript?.trim();
        if (transcript) parts.push(transcript);
      }

      const transcript = parts.join(' ').trim();
      if (transcript.length > 0) {
        transcriptSeenRef.current = true;
        onTranscript(transcript);
        setMessage('Texto reconhecido. Revise antes de enviar.');
      }
    };

    recognition.onerror = (event) => {
      if (startAttemptRef.current !== attempt) return;
      recognitionErrorRef.current = true;
      clearStartWatchdog();
      clearListeningWatchdog();
      setStarting(false);
      setListening(false);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
        permissionCheckedRef.current = false;
      }
      const nextMessage = voiceErrorMessage(event.error);
      if (nextMessage !== null) setMessage(nextMessage);
    };

    recognition.onend = () => {
      if (startAttemptRef.current !== attempt) return;
      clearStartWatchdog();
      clearListeningWatchdog();
      setStarting(false);
      setListening(false);
      recognitionRef.current = null;
      if (!transcriptSeenRef.current && !recognitionErrorRef.current) {
        setMessage('A escuta terminou, mas não recebi texto. Tente novamente e fale logo após aparecer “Ouvindo...”.');
      }
    };

    recognitionRef.current = recognition;
    startWatchdogRef.current = window.setTimeout(() => {
      if (recognitionRef.current !== recognition || startAttemptRef.current !== attempt) return;
      recognition.abort();
      recognitionRef.current = null;
      startWatchdogRef.current = null;
      setStarting(false);
      setListening(false);
      setMessage('O microfone foi liberado, mas o reconhecimento de voz não respondeu. No Safari do iPhone ou Mac, confirme que Siri e Ditado estão ativados; depois tente novamente.');
    }, START_WATCHDOG_MS);

    try {
      recognition.start();
    } catch {
      if (startAttemptRef.current !== attempt) return;
      clearStartWatchdog();
      clearListeningWatchdog();
      recognitionRef.current = null;
      setStarting(false);
      setListening(false);
      setMessage('Não consegui iniciar o reconhecimento de voz. Tente novamente ou confirme Siri e Ditado nas configurações do aparelho.');
    }
  }

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
        O microfone só é ativado após o seu toque. Nesta etapa, o Mente Livre não grava, persiste nem envia áudio bruto; a conversão em texto usa o reconhecimento disponível no navegador/aparelho.
      </p>
    </div>
  );
}
