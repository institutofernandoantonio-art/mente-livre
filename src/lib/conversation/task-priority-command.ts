import 'server-only';

import { revalidatePath } from 'next/cache';
import { createClient } from '../supabase/server';
import { matchEventReference, type ReferenceCandidate } from './reference-matching';
import type { TaskPriorityBucket, TaskPriorityCommand } from './task-priority-parser';

export { parseTaskPriorityCommand } from './task-priority-parser';
export type { TaskPriorityBucket, TaskPriorityCommand } from './task-priority-parser';

export type TaskPriorityCommandResult =
  | { status: 'updated'; bucket: TaskPriorityBucket }
  | { status: 'not_found' }
  | { status: 'ambiguous' }
  | { status: 'error' };

export async function applyTaskPriorityCommand(command: TaskPriorityCommand): Promise<TaskPriorityCommandResult> {
  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims.sub;
    if (!userId) return { status: 'error' };

    const { data: rows, error: readError } = await supabase
      .from('items')
      .select('id, title, category')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('needs_confirmation', false);

    if (readError) return { status: 'error' };

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
    if (matched.status === 'not_found' || matched.status === 'unsupported') return { status: 'not_found' };

    const { data, error: updateError } = await supabase
      .from('items')
      .update({ priority: command.priority })
      .eq('id', matched.candidate.id)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('needs_confirmation', false)
      .select('id')
      .maybeSingle();

    if (updateError) return { status: 'error' };
    if (data === null) return { status: 'not_found' };

    revalidatePath('/tarefas');
    revalidatePath('/hoje');
    return { status: 'updated', bucket: command.bucket };
  } catch {
    return { status: 'error' };
  }
}
