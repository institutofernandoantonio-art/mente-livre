'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type CompleteTaskResult = { status: 'completed' } | { status: 'not_found' } | { status: 'error' };
export type CancelTaskResult = { status: 'cancelled' } | { status: 'not_found' } | { status: 'error' };
export type TaskPriority = 'alta' | 'média' | 'baixa';
export type SetTaskPriorityResult =
  | { status: 'updated'; priority: TaskPriority }
  | { status: 'not_found' }
  | { status: 'invalid_priority' }
  | { status: 'error' };

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return value === 'alta' || value === 'média' || value === 'baixa';
}

async function getAuthenticatedContext() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  return { supabase, userId: typeof userId === 'string' && userId ? userId : null };
}

export async function completeTask(taskId: string): Promise<CompleteTaskResult> {
  if (!isNonBlankString(taskId)) return { status: 'not_found' };

  try {
    const { supabase, userId } = await getAuthenticatedContext();
    if (!userId) return { status: 'error' };

    const { data, error } = await supabase
      .from('items')
      .update({ status: 'completed' })
      .eq('id', taskId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('needs_confirmation', false)
      .select('id')
      .maybeSingle();

    if (error) return { status: 'error' };
    if (data === null) return { status: 'not_found' };

    revalidatePath('/tarefas');
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
    const { supabase, userId } = await getAuthenticatedContext();
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
    return { status: 'cancelled' };
  } catch {
    return { status: 'error' };
  }
}

export async function cancelTaskAction(taskId: string): Promise<void> {
  await cancelTask(taskId);
}

// Primeira camada de priorização operacional.
// Usa a coluna `priority` já existente; não cria migration nem amplia privilégios.
// Só tarefas já confirmadas e ainda pendentes podem ser alteradas.
export async function setTaskPriority(
  taskId: string,
  priority: TaskPriority,
): Promise<SetTaskPriorityResult> {
  if (!isNonBlankString(taskId)) return { status: 'not_found' };
  if (!isTaskPriority(priority)) return { status: 'invalid_priority' };

  try {
    const { supabase, userId } = await getAuthenticatedContext();
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
    return { status: 'updated', priority };
  } catch {
    return { status: 'error' };
  }
}

export async function setTaskPriorityAction(taskId: string, priority: TaskPriority): Promise<void> {
  await setTaskPriority(taskId, priority);
}
