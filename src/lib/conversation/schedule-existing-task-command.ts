import 'server-only';

import { createClient } from '../supabase/server';
import { matchEventReference, type ReferenceCandidate } from './reference-matching';
import {
  addCivilDays,
  getCivilDateInTimeZone,
  isValidTimeZone,
  resolveCivilDateTimeInTimeZone,
} from './timezone';
import type { StructuredIntent } from './types';

type CreateEventIntent = Extract<StructuredIntent, { intentType: 'create_event' }>;
type RelativeScheduleDay = 'today' | 'tomorrow';

export type ScheduleExistingTaskCommand = {
  referenceRaw: string;
  day: RelativeScheduleDay;
  hour: number;
  minute: number;
};

export type ScheduleExistingTaskResult =
  | { status: 'ready'; intent: CreateEventIntent }
  | { status: 'not_found' }
  | { status: 'ambiguous' }
  | { status: 'invalid_timezone' }
  | { status: 'error' };

function cleanReference(raw: string): string {
  return raw
    .trim()
    .replace(/\s+(?:hoje|amanh[aã])$/iu, '')
    .replace(/^(?:(?:a|o)\s+)?tarefa\s+/iu, '')
    .replace(/[.!?]+$/u, '')
    .trim();
}

function parseClock(rawHour: string, rawMinute?: string): { hour: number; minute: number } | null {
  const hour = Number(rawHour);
  const minute = rawMinute ? Number(rawMinute) : 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function parseScheduleExistingTaskCommand(text: string): ScheduleExistingTaskCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const match = trimmed.match(
    /^(?:agende|agendar|marque|marcar)\s+(.+?)\s+(?:(hoje|amanh[aã])\s+)?(?:às|as)\s+(\d{1,2})(?::(\d{2})|h(\d{2}))?\s*(?:h|horas?)?[.!?]*$/iu,
  );
  if (!match) return null;

  const referenceRaw = cleanReference(match[1]);
  if (!referenceRaw || /^(?:isso|isto|essa|esse|ela|ele)$/iu.test(referenceRaw)) return null;
  const clock = parseClock(match[3], match[4] ?? match[5]);
  if (!clock) return null;
  const day: RelativeScheduleDay = match[2] && /^amanh[aã]$/iu.test(match[2]) ? 'tomorrow' : 'today';
  return { referenceRaw, day, ...clock };
}

export async function resolveScheduleExistingTaskCommand(
  command: ScheduleExistingTaskCommand,
  timeZone: string,
  now: number,
): Promise<ScheduleExistingTaskResult> {
  if (!isValidTimeZone(timeZone) || !Number.isSafeInteger(now)) return { status: 'invalid_timezone' };

  const instant = new Date(now);
  const today = getCivilDateInTimeZone(instant, timeZone);
  const tomorrow = addCivilDays(today, 1);
  const start = resolveCivilDateTimeInTimeZone(today.year, today.month, today.day, 0, 0, timeZone);
  const end = resolveCivilDateTimeInTimeZone(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, timeZone);
  if (start.status !== 'resolved' || end.status !== 'resolved') return { status: 'invalid_timezone' };

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims.sub;
    if (!userId) return { status: 'error' };

    const { data: rows, error } = await supabase
      .from('items')
      .select('id, title, category')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('needs_confirmation', false)
      .gte('deadline_at', start.utc.toISOString())
      .lt('deadline_at', end.utc.toISOString());

    if (error) return { status: 'error' };

    const candidates: ReferenceCandidate[] = (rows ?? []).map((row) => ({
      source: 'local_item',
      id: row.id,
      title: row.title,
      category: row.category,
    }));

    const matched = matchEventReference(
      { kind: 'existing_reference', raw: command.referenceRaw, resolvedId: null },
      candidates,
    );

    if (matched.status === 'ambiguous') return { status: 'ambiguous' };
    if (matched.status !== 'resolved') return { status: 'not_found' };

    const dayLabel = command.day === 'today' ? 'hoje' : 'amanhã';
    return {
      status: 'ready',
      intent: {
        intentType: 'create_event',
        task: { kind: 'new_task', title: matched.candidate.title, description: null },
        temporalWindow: {
          expression: `${dayLabel} às ${String(command.hour).padStart(2, '0')}:${String(command.minute).padStart(2, '0')}`,
          resolved: { kind: 'relative_day', day: command.day, time: { hour: command.hour, minute: command.minute } },
        },
        duration: null,
        participants: [],
        calendarAction: 'create',
        missingFields: [],
        confidence: 1,
      },
    };
  } catch {
    return { status: 'error' };
  }
}
