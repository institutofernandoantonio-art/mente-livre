'use server';

import { createClient } from '@/lib/supabase/server';
import {
  addCivilDays,
  getCivilDateInTimeZone,
  isValidTimeZone,
  resolveCivilDateTimeInTimeZone,
} from '@/lib/conversation/timezone';

export type TodaySummaryResult =
  | {
      status: 'ok';
      total: number;
      items: Array<{ id: string; title: string; completedAt: string }>;
      timeZone: string;
    }
  | { status: 'error' };

export async function getTodaySummary(timeZone: string): Promise<TodaySummaryResult> {
  if (!isValidTimeZone(timeZone)) return { status: 'error' };

  const now = new Date();
  const today = getCivilDateInTimeZone(now, timeZone);
  const tomorrow = addCivilDays(today, 1);
  const start = resolveCivilDateTimeInTimeZone(today.year, today.month, today.day, 0, 0, timeZone);
  const end = resolveCivilDateTimeInTimeZone(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, timeZone);

  if (start.status !== 'resolved' || end.status !== 'resolved') {
    return { status: 'error' };
  }

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims.sub;
    if (!userId) return { status: 'error' };

    const { data, error, count } = await supabase
      .from('items')
      .select('id, title, completed_at', { count: 'exact' })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .eq('needs_confirmation', false)
      .gte('completed_at', start.utc.toISOString())
      .lt('completed_at', end.utc.toISOString())
      .order('completed_at', { ascending: false })
      .limit(10);

    if (error || data === null) return { status: 'error' };

    const items = data.flatMap((item) =>
      typeof item.completed_at === 'string'
        ? [{ id: item.id, title: item.title, completedAt: item.completed_at }]
        : [],
    );

    return {
      status: 'ok',
      total: count ?? items.length,
      items,
      timeZone,
    };
  } catch {
    return { status: 'error' };
  }
}
