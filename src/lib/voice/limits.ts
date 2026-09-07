export const VOICE_MAX_DURATION_MS = 20_000;
export const VOICE_MAX_AUDIO_BYTES = 2 * 1024 * 1024;

// GPT-Transcribe: US$ 0,0045/minuto (4500 microUSD/min).
// Esta constante é usada somente para estimativa conservadora de custo do
// MVP. Trocar de modelo/preço exige mudança explícita de código e revisão.
export const GPT_TRANSCRIBE_PRICE_MICROUSD_PER_MINUTE = 4_500;

// Teto rígido interno do Mente Livre. O banco também aplica este valor de
// forma atômica antes de qualquer chamada ao provedor.
export const VOICE_INTERNAL_MONTHLY_CAP_MICROUSD = 4_000_000;
export const VOICE_INTERNAL_MONTHLY_CAP_USD = 4;

// O hard cap externo planejado para o projeto OpenAI dedicado é US$ 5/mês.
// Ele NÃO substitui o teto interno de US$ 4; funciona como segunda barreira.
export const VOICE_EXTERNAL_PROJECT_HARD_CAP_USD = 5;

export function estimateVoiceCostMicrousd(durationMs: number): number {
  const safeDuration = Math.max(0, Math.min(VOICE_MAX_DURATION_MS, Math.trunc(durationMs)));
  return Math.ceil((safeDuration * GPT_TRANSCRIBE_PRICE_MICROUSD_PER_MINUTE) / 60_000);
}

export const VOICE_MAX_RESERVED_COST_MICROUSD = estimateVoiceCostMicrousd(VOICE_MAX_DURATION_MS);

export function microusdToUsd(microusd: number): number {
  return microusd / 1_000_000;
}
