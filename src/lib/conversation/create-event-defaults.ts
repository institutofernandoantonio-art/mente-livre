import type { StructuredIntent } from './types';

const DEFAULT_CREATE_EVENT_DURATION_MINUTES = 60;
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 12 * 60;

function explicitFixedWindowDurationMinutes(intent: Extract<StructuredIntent, { intentType: 'create_event' }>): number | null {
  const resolved = intent.temporalWindow.resolved;
  if (resolved.kind !== 'fixed') return null;

  const startMs = Date.parse(resolved.start);
  const endMs = Date.parse(resolved.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

  const durationMinutes = (endMs - startMs) / 60_000;
  if (!Number.isInteger(durationMinutes)) return null;
  if (durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) return null;
  return durationMinutes;
}

/**
 * Regra de produto para criação de compromissos:
 * - duração explicitamente dita pelo usuário (`source: stated`) vence sempre;
 * - intervalo fixo com início/fim explícitos usa a duração desse intervalo;
 * - sem duração explícita, reserva 60 minutos.
 *
 * A regra só completa o intent. Ela nunca confirma nem executa o evento:
 * a proposta e o "sim" explícito continuam obrigatórios antes do write no
 * Google Calendar.
 */
export function applyCreateEventDefaults(intent: StructuredIntent): StructuredIntent {
  if (intent.intentType !== 'create_event') return intent;
  if (intent.duration?.source === 'stated') return intent;

  const fixedDuration = explicitFixedWindowDurationMinutes(intent);
  const minutes = fixedDuration ?? DEFAULT_CREATE_EVENT_DURATION_MINUTES;

  return {
    ...intent,
    missingFields: intent.missingFields.filter((field) => field !== 'duration'),
    duration: {
      source: 'inferred',
      value: { minutes },
      confidence: 1,
    },
  };
}

export { DEFAULT_CREATE_EVENT_DURATION_MINUTES };
