'use server';

import { createClient } from '@/lib/supabase/server';
import {
  addCivilDays,
  getCivilDateInTimeZone,
  isValidTimeZone,
  resolveCivilDateTimeInTimeZone,
} from '@/lib/conversation/timezone';
import type { TaskPriority } from '@/app/tarefas/priority-actions';

export type TodayChecklistResult =
  | {
      status: 'ok';
      items: Array<{ id: string; title: string; priority: TaskPriority | null }>;
    }
  | { status: 'error' };

const priorityRank: Record<TaskPriority, number> = {
  alta: 0,
  média: 1,
  baixa: 2,
};

function checklistOrder(item: { priority: TaskPriority | null }) {
  return item.priority ? priorityRank[item.priority] : 3;
}

export async function getTodayChecklist(timeZone: string): Promise<TodayChecklistResult> {
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

    const { data, error } = await supabase
      .from('items')
      .select('id, title, priority, created_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('needs_confirmation', false)
      .gte('deadline_at', start.utc.toISOString())
      .lt('deadline_at', end.utc.toISOString())
      .order('created_at', { ascending: true });

    if (error || data === null) return { status: 'error' };

    return {
      status: 'ok',
      items: [...data]
        .sort((a, b) => checklistOrder(a) - checklistOrder(b))
        .map((item) => ({ id: item.id, title: item.title, priority: item.priority })),
    };
  } catch {
    return { status: 'error' };
  }
}
