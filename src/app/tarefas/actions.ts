'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type CompleteTaskResult = { status: 'completed' } | { status: 'not_found' } | { status: 'error' };
export type CancelTaskResult = { status: 'cancelled' } | { status: 'not_found' } | { status: 'error' };

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function completeTask(taskId: string): Promise<CompleteTaskResult> {
  if (!isNonBlankString(taskId)) return { status: 'not_found' };

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims.sub;

    if (!userId) return { status: 'error' };

    const completedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('items')
      .update({ status: 'completed', completed_at: completedAt })
      .eq('id', taskId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('needs_confirmation', false)
      .select('id')
      .maybeSingle();

    if (error) return { status: 'error' };
    if (data === null) return { status: 'not_found' };

    revalidatePath('/tarefas');
    revalidatePath('/hoje');
    return { status: 'completed' };
  } catch {
    return { status: 'error' };
  }
}

export async function completeTaskAction(taskId: string): Promise<void> {
  await completeTask(taskId);
}

export async function cancelTask(taskId: string): Promise<CancelTaskResult> {
  if (!isNonBlankString(taskId)) return { status: 'not_found' };

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims.sub;

    if (!userId) return { status: 'error' };

    const { data, error } = await supabase
      .from('items')
      .update({ status: 'cancelled' })
      .eq('id', taskId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('needs_confirmation', false)
      .select('id')
      .maybeSingle();

    if (error) return { status: 'error' };
    if (data === null) return { status: 'not_found' };

    revalidatePath('/tarefas');
    revalidatePath('/hoje');
    return { status: 'cancelled' };
  } catch {
    return { status: 'error' };
  }
}

export async function cancelTaskAction(taskId: string): Promise<void> {
  await cancelTask(taskId);
}
