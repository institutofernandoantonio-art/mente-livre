import 'server-only';
import { OpenAISttProvider } from './openai-stt-provider';
import type { SpeechToTextProvider } from './stt-provider';

export function isServerVoiceSttEnabled(): boolean {
  return process.env.MENTE_LIVRE_STT_ENABLED === 'true';
}

export function getSpeechToTextProvider(): SpeechToTextProvider {
  if (!isServerVoiceSttEnabled()) {
    throw new Error('Voice transcription is disabled.');
  }

  const provider = process.env.MENTE_LIVRE_STT_PROVIDER ?? 'openai';

  switch (provider) {
    case 'openai':
      return new OpenAISttProvider();
    default:
      // Troca de provedor é deliberadamente explícita: arquitetura está
      // desacoplada, mas nenhum provedor/custo novo entra por variável sem
      // mudança de código revisável.
      throw new Error('Unsupported voice transcription provider.');
  }
}
