import type { StructuredIntent } from './types';
import {
  addCivilDays,
  getCivilDateInTimeZone,
  isValidTimeZone,
  resolveCivilDateTimeInTimeZone,
} from './timezone';

type CreateTaskIntent = Extract<StructuredIntent, { intentType: 'create_task' }>;

/**
 * Materializa somente janelas relativas simples de tarefas locais
 * ("hoje"/"amanhã") como deadline absoluto no fuso do usuário.
 *
 * Regras conservadoras:
 * - só atua em create_task;
 * - só atua se ainda não existe deadline explícito;
 * - só resolve temporalWindow.relative_day;
 * - com hora explícita, preserva a hora como `stated`;
 * - sem hora, usa 23:59 do dia como deadline `inferred`;
 * - timezone/instante inválido ou horário civil não resolvível => mantém
 *   o intent intacto, para o pipeline falhar fechado como antes;
 * - nunca altera outras janelas (fixed, next_free_slot, relative_to_event,
 *   unresolved), porque elas continuam pertencendo ao Planning.
 */
export function normalizeCreateTaskRelativeDay(
  intent: StructuredIntent,
  now: number,
  timeZone: string,
): StructuredIntent {
  if (intent.intentType !== 'create_task') return intent;
  if (intent.deadline !== null) return intent;
  if (intent.temporalWindow === null) return intent;
  if (intent.temporalWindow.resolved.kind !== 'relative_day') return intent;
  if (!Number.isSafeInteger(now)) return intent;
  if (!isValidTimeZone(timeZone)) return intent;

  const relative = intent.temporalWindow.resolved;
  const today = getCivilDateInTimeZone(new Date(now), timeZone);
  const targetDate = relative.day === 'tomorrow' ? addCivilDays(today, 1) : today;
  const hour = relative.time?.hour ?? 23;
  const minute = relative.time?.minute ?? 59;
  const resolution = resolveCivilDateTimeInTimeZone(
    targetDate.year,
    targetDate.month,
    targetDate.day,
    hour,
    minute,
    timeZone,
  );

  if (resolution.status !== 'resolved') return intent;

  const normalized: CreateTaskIntent = {
    ...intent,
    temporalWindow: null,
    deadline: {
      source: relative.time === null ? 'inferred' : 'stated',
      value: { at: resolution.utc.toISOString() },
      confidence: intent.confidence,
    },
  };

  return normalized;
}
