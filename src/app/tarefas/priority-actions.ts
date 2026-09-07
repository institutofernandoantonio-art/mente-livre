'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type TaskPriority = 'alta' | 'média' | 'baixa';
export type TaskPriorityInput = TaskPriority | null;
export type SetTaskPriorityResult =
  | { status: 'updated'; priority: TaskPriorityInput }
  | { status: 'not_found' }
  | { status: 'invalid_priority' }
  | { status: 'error' };

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTaskPriorityInput(value: unknown): value is TaskPriorityInput {
  return value === null || value === 'alta' || value === 'média' || value === 'baixa';
}

export async function setTaskPriority(
  taskId: string,
  priority: TaskPriorityInput,
): Promise<SetTaskPriorityResult> {
  if (!isNonBlankString(taskId)) return { status: 'not_found' };
  if (!isTaskPriorityInput(priority)) return { status: 'invalid_priority' };

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims.sub;

    if (!userId) return { status: 'error' };

    const { data, error } = await supabase
      .from('items')
      .update({ priority })
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
    return { status: 'updated', priority };
  } catch {
    return { status: 'error' };
  }
}

export async function setTaskPriorityAction(taskId: string, priority: TaskPriorityInput): Promise<void> {
  await setTaskPriority(taskId, priority);
}
