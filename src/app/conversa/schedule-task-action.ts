'use server';

import { createClient } from '@/lib/supabase/server';

export type ResolveScheduleTaskResult =
  | { status: 'ok'; title: string }
  | { status: 'not_found' }
  | { status: 'error' };

export async function resolveScheduleTask(taskId: string): Promise<ResolveScheduleTaskResult> {
  if (typeof taskId !== 'string' || !taskId.trim()) return { status: 'not_found' };

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims.sub;
    if (!userId) return { status: 'error' };

    const { data, error } = await supabase
      .from('items')
      .select('title')
      .eq('id', taskId.trim())
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('needs_confirmation', false)
      .maybeSingle();

    if (error) return { status: 'error' };
    if (!data || typeof data.title !== 'string' || !data.title.trim()) return { status: 'not_found' };

    return { status: 'ok', title: data.title.trim() };
  } catch {
    return { status: 'error' };
  }
}
