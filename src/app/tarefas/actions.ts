'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// ============================================================================
// Server Action de conclusão de tarefa — a única mutação desta rota.
//
// Escopo estritamente `pending → completed`. Este arquivo NUNCA:
// - edita título/descrição/prazo — só `status`;
// - exclui nada — zero `.delete(`;
// - reabre uma tarefa (`completed`/`cancelled` → `pending`) — a `WHERE`
//   abaixo só casa `status = 'pending'`, nunca o inverso;
// - conclui um item com `needs_confirmation = true` — esses itens nunca
//   foram confirmados como tarefa real pelo usuário (só sugeridos pela
//   IA do fluxo antigo de brain dump), então "concluir" não faz sentido
//   semântico para eles; a `WHERE` exige `needs_confirmation = false`
//   como defesa em profundidade, mesmo que a listagem (`page.tsx`) já
//   filtre isso visualmente;
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
//   (já em produção) já faz isso automaticamente em todo UPDATE.
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
    // Input inválido — zero I/O, mesma disciplina de boundary do resto
    // do projeto. `not_found` mantém o contrato simples: um id que não
    // corresponde a nada real (inclusive um id malformado) nunca é
    // distinguido de qualquer outro caso de zero-match.
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

    if (error) {
      // Nenhum detalhe do erro do Supabase (mensagem/SQL/stack) cruza
      // esta fronteira — só o status técnico.
      return { status: 'error' };
    }

    if (data === null) {
      // Zero linhas casadas — id errado, não é sua, já não está mais
      // `pending`, ou `needs_confirmation=true`: todos colapsam aqui,
      // nunca uma segunda consulta para explicar qual foi o motivo.
      return { status: 'not_found' };
    }

    // Sucesso real — revalida a listagem para o usuário ver "Concluída"
    // imediatamente. Nunca revalidado nos ramos not_found/error.
    revalidatePath('/tarefas');
    return { status: 'completed' };
  } catch {
    // createClient()/getClaims()/update() lançando fora do contrato
    // normal `{data, error}` — mesma convenção já usada em
    // local-task-execution.ts/actions.ts: nunca logado cru, sempre
    // mapeado para o mesmo status técnico genérico.
    return { status: 'error' };
  }
}

// Wrapper que só existe para satisfazer o contrato de `<form action={...}>`
// (React exige `void | Promise<void>`, nunca um valor — ver
// `page.tsx`) — precisa viver AQUI, não em `page.tsx`: só uma função
// exportada de um módulo `'use server'` (ou com `'use server'` inline no
// próprio corpo) pode ser passada como `action` de um form; uma função
// comum declarada dentro de um Server Component, mesmo sem `'use
// client'`, é rejeitada pelo React nesse ponto específico ("Functions
// cannot be passed directly... unless explicitly exposed with 'use
// server'"). Nenhuma lógica nova: só chama `completeTask` e descarta o
// resultado, mesmo comportamento já previsto para esta V1 (sem camada
// visual de erro ainda).
export async function completeTaskAction(taskId: string): Promise<void> {
  await completeTask(taskId);
}
