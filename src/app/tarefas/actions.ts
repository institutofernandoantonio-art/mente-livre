'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// ============================================================================
// Server Actions de mutação de tarefa — as únicas mutações desta rota.
//
// Duas transições, cada uma com escopo estritamente `pending → X`
// (`completed` ou `cancelled`), nunca o inverso e nunca cruzadas entre si.
// Este arquivo NUNCA:
// - edita título/descrição/prazo — só `status`;
// - exclui nada — zero `.delete(`;
// - reabre uma tarefa (`completed`/`cancelled` → `pending`) — cada `WHERE`
//   abaixo só casa `status = 'pending'`, nunca o inverso;
// - transiciona `completed` para `cancelled` nem vice-versa — cada UPDATE
//   só parte de `pending`, então uma tarefa já finalizada (por qualquer
//   dos dois caminhos) nunca é afetada pelo outro;
// - conclui/cancela um item com `needs_confirmation = true` — esses itens
//   nunca foram confirmados como tarefa real pelo usuário (só sugeridos
//   pela IA do fluxo antigo de brain dump), então nenhuma das duas
//   transições faz sentido semântico para eles; cada `WHERE` exige
//   `needs_confirmation = false` como defesa em profundidade, mesmo que a
//   listagem (`page.tsx`) já filtre isso visualmente;
// - usa admin client/service role — `createClient()` normal já é
//   suficiente: RLS (`items_update_own`, já em produção) é a autoridade
//   de segurança, e os filtros explícitos abaixo (`user_id`/`status`/
//   `needs_confirmation`) são reforço em profundidade, mesmo padrão já
//   usado em toda a pilha conversacional;
// - usa RPC/lock manual — um único `UPDATE ... WHERE` condicional já é
//   atômico o suficiente a nível de linha (MVCC do Postgres), mesma
//   garantia que `advanceRuntimeState`/`consumeRuntimeState` já usam;
// - faz leitura prévia, retry, ou uma segunda query para "explicar" um
//   resultado vazio — mesma disciplina anti-TOCTOU já estabelecida em
//   `conversation-turn.ts`/`local-task-execution.ts`: zero linhas casadas
//   por QUALQUER motivo (id errado, não é sua, já não está mais
//   `pending`, `needs_confirmation=true`) colapsa num único `not_found`,
//   nunca revelando qual desses foi o motivo real;
// - seta `updated_at` manualmente — o trigger `set_items_updated_at`
//   (já em produção) já faz isso automaticamente em todo UPDATE;
// - pede confirmação dupla, motivo de cancelamento, ou undo — cancelar é
//   uma transição direta, mesmo padrão de UX de concluir; nada disso está
//   nesta V1.
//
// `taskId` não é segredo — é só o id de uma linha própria; a segurança
// real vem inteiramente da sessão autenticada + RLS + filtros explícitos,
// nunca de o id em si ser difícil de adivinhar.
// ============================================================================

export type CompleteTaskResult = { status: 'completed' } | { status: 'not_found' } | { status: 'error' };

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function completeTask(taskId: string): Promise<CompleteTaskResult> {
  if (!isNonBlankString(taskId)) {
    return { status: 'not_found' };
  }

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims.sub;

    if (!userId) {
      return { status: 'error' };
    }

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

export type CancelTaskResult = { status: 'cancelled' } | { status: 'not_found' } | { status: 'error' };

export async function cancelTask(taskId: string): Promise<CancelTaskResult> {
  if (!isNonBlankString(taskId)) {
    return { status: 'not_found' };
  }

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims.sub;

    if (!userId) {
      return { status: 'error' };
    }

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
