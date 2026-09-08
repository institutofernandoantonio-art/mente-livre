import 'server-only';

import { revalidatePath } from 'next/cache';
import { createClient } from '../supabase/server';
import { matchEventReference, type ReferenceCandidate } from './reference-matching';

export type TaskPriorityBucket = 'fazer_hoje' | 'planejar' | 'delegar' | 'depois';
type TaskPriorityValue = 'alta' | 'média' | 'baixa' | null;

export type TaskPriorityCommand = {
  referenceRaw: string;
  priority: TaskPriorityValue;
  bucket: TaskPriorityBucket;
};

export type TaskPriorityCommandResult =
  | { status: 'updated'; bucket: TaskPriorityBucket }
  | { status: 'not_found' }
  | { status: 'ambiguous' }
  | { status: 'error' };

const CLASSIFICATIONS: Array<{
  expressions: string[];
  priority: TaskPriorityValue;
  bucket: TaskPriorityBucket;
}> = [
  {
    expressions: ['urgente e importante', 'fazer hoje'],
    priority: 'alta',
    bucket: 'fazer_hoje',
  },
  {
    expressions: ['importante mas não urgente', 'importante mas nao urgente', 'planejar'],
    priority: 'média',
    bucket: 'planejar',
  },
  {
    expressions: ['urgente mas menos importante', 'delegar'],
    priority: 'baixa',
    bucket: 'delegar',
  },
  {
    expressions: ['sem urgência agora', 'sem urgencia agora', 'depois'],
    priority: null,
    bucket: 'depois',
  },
];

function cleanReference(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:a|o)\s+tarefa\s+/iu, '')
    .replace(/[.!?]+$/u, '')
    .trim();
}

export function parseTaskPriorityCommand(text: string): TaskPriorityCommand | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  for (const classification of CLASSIFICATIONS) {
    for (const expression of classification.expressions) {
      const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patterns = [
        new RegExp(`^(?:marque|classifique|coloque)\\s+(.+?)\\s+como\\s+${escaped}[.!?]*$`, 'iu'),
        new RegExp(`^(.+?)\\s+(?:é|e)\\s+${escaped}[.!?]*$`, 'iu'),
      ];

      for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (!match) continue;
        const referenceRaw = cleanReference(match[1]);
        if (referenceRaw.length === 0) return null;
        return {
          referenceRaw,
          priority: classification.priority,
          bucket: classification.bucket,
        };
      }
    }
  }

  return null;
}

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
