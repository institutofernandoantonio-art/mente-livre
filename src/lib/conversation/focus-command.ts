import 'server-only';

import { createClient } from '../supabase/server';
import { matchEventReference, type ReferenceCandidate } from './reference-matching';
import {
  addCivilDays,
  getCivilDateInTimeZone,
  isValidTimeZone,
  resolveCivilDateTimeInTimeZone,
} from './timezone';

export type FocusMinutes = 25 | 50;

export type FocusCommand = {
  referenceRaw: string;
  minutes: FocusMinutes;
};

export type FocusCommandResult =
  | { status: 'ready'; taskId: string; taskTitle: string; minutes: FocusMinutes }
  | { status: 'not_found' }
  | { status: 'ambiguous' }
  | { status: 'invalid_timezone' }
  | { status: 'error' };

function cleanReference(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:(?:a|o)\s+)?tarefa\s+/iu, '')
    .replace(/[.!?]+$/u, '')
    .trim();
}

export function parseFocusCommand(text: string): FocusCommand | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const patterns = [
    /^(?:comece|começar|comecar|inicie|iniciar)\s+(?:um\s+)?foco\s+de\s+(25|50)\s*(?:min|minutos?)\s+(?:em|na|no)\s+(.+?)[.!?]*$/iu,
    /^foco\s+(?:de\s+)?(25|50)\s*(?:min|minutos?)\s+(?:em|na|no)\s+(.+?)[.!?]*$/iu,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const referenceRaw = cleanReference(match[2]);
    if (referenceRaw.length === 0 || /^(?:isso|isto|essa|esse|ela|ele)$/iu.test(referenceRaw)) return null;
    return { referenceRaw, minutes: Number(match[1]) as FocusMinutes };
  }

  return null;
}

export async function resolveFocusCommand(
  command: FocusCommand,
  timeZone: string,
  now: number,
): Promise<FocusCommandResult> {
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

    return {
      status: 'ready',
      taskId: matched.candidate.id,
      taskTitle: matched.candidate.title,
      minutes: command.minutes,
    };
  } catch {
    return { status: 'error' };
  }
}
