import 'server-only';

export type TranscriptionRequest = {
  audio: File;
  language?: string;
};

export type TranscriptionResult = {
  text: string;
};

export type SpeechToTextProvider = {
  readonly provider: string;
  readonly model: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
};
