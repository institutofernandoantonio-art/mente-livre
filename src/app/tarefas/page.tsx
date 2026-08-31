import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button, buttonVariants } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/server';
import { statusLabel, formatDeadline } from './presentation';
import { completeTaskAction, cancelTaskAction } from './actions';

// ============================================================================
// Listagem read-only de tarefas — fecha o ciclo mínimo da V1: CRIAR → VER.
//
// Server Component fino, mesmo padrão de `/entrada`/`/conversa`: só lê e
// estrutura a página, nenhuma lógica de domínio própria (a apresentação de
// `status`/`deadline_at` já vem de `./presentation.ts`, puro e testável).
//
// Este arquivo NUNCA:
// - aceita `userId` de fora — sempre derivado de `getClaims()` server-side,
//   nunca de query string/parâmetro de rota/formulário/cookie manual/
//   localStorage;
// - usa admin client/service role — `createClient()` normal já é
//   suficiente: RLS (`items_select_own`, já em produção) é a autoridade de
//   segurança, e o filtro explícito `.eq('user_id', userId)` abaixo é
//   reforço em profundidade, mesmo padrão já usado em
//   `reference-resolution.ts`/`planning-context.ts`;
// - muta nada NESTE arquivo — a única operação de leitura é um `select`,
//   nunca insert/update/delete/upsert/rpc; as únicas mutações reais da
//   rota (`pending → completed`, `pending → cancelled`) vivem
//   inteiramente em `./actions.ts`;
// - expõe `proposalId`/`brainDumpId`/`userId`/nenhum id interno — só
//   `title`/`status` (já humanizado)/prazo (já formatado). `id` é lido só
//   como `key` do React e como argumento do form bound (nunca renderizado
//   como texto), mesma disciplina já usada para `id` visual em
//   `ConversationPanel.tsx`;
// - altera o fluxo conversacional — `ConversationPanel.tsx` permanece
//   intocado; a única ligação é um link de navegação em `/conversa`.
//
// `needs_confirmation = false`: filtro novo desta subfase — sem ele, a
// listagem misturava tarefas conversacionais reais (`needs_confirmation:
// false`) com sugestões do fluxo antigo de brain dump nunca confirmadas
// pelo usuário (`needs_confirmation: true`, ver `actions.ts` de
// `supabase/actions.ts`: "a IA só recomenda, nada é executado
// automaticamente"). `/tarefas` agora representa só itens operacionais
// já confirmados — nunca filtrado por `category`, que sozinho não
// bastaria (brain dumps de categoria `tarefa` também têm
// `needs_confirmation: true`).
//
// Ordenação: `created_at DESC` (mais recentes primeiro) — única e simples,
// sem nenhuma lógica de prioridade/Eisenhower nesta subfase.
// ============================================================================

type TaskRow = {
  id: string;
  title: string;
  status: string;
  deadline_at: string | null;
};

export default async function TarefasPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;

  let tasks: TaskRow[] = [];
  let loadFailed = false;

  if (typeof userId === 'string' && userId) {
    const { data, error } = await supabase
      .from('items')
      .select('id, title, status, deadline_at')
      .eq('user_id', userId)
      .eq('needs_confirmation', false)
      .order('created_at', { ascending: false });

    if (error || data === null) {
      // Mensagem genérica de propósito, mesmo padrão do resto do projeto:
      // nunca expõe detalhe do erro do Supabase (mensagem/SQL/stack).
      loadFailed = true;
    } else {
      tasks = data;
    }
  } else {
    // Sessão ausente/claims sem `sub` — estruturalmente já barrado por
    // `src/proxy.ts` (AAL2) antes de a página renderizar, mas esta camada
    // nunca assume isso: fail-closed, mesmo padrão do resto do projeto.
    loadFailed = true;
  }

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-lg font-semibold text-ink">Minhas tarefas</h1>

        {loadFailed && <ErrorState message="Não foi possível carregar suas tarefas agora." />}

        {!loadFailed && tasks.length === 0 && <EmptyState title="Você ainda não tem tarefas." />}

        {!loadFailed && tasks.length > 0 && (
          <Card className="flex flex-col gap-3">
            {tasks.map((task) => {
              const deadlineText = formatDeadline(task.deadline_at);
              return (
                <div key={task.id} className="rounded-xl border border-mist-200 p-4">
                  <p className="font-medium text-ink">{task.title}</p>
                  <p className="mt-1 text-sm text-ink-soft">{statusLabel(task.status)}</p>
                  {deadlineText && <p className="mt-1 text-sm text-ink-soft">Prazo: {deadlineText}</p>}
                  {task.status === 'pending' && (
                    <div className="mt-3 flex gap-2">
                      <form action={completeTaskAction.bind(null, task.id)}>
                        <Button type="submit" variant="secondary">
                          Concluir
                        </Button>
                      </form>
                      <form action={cancelTaskAction.bind(null, task.id)}>
                        <Button type="submit" variant="ghost">
                          Cancelar
                        </Button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        )}

        <div className="mt-6 flex flex-col items-center gap-3">
          <Link href="/conversa" className={buttonVariants('secondary')}>
            Voltar para conversa
          </Link>
        </div>
      </div>
    </main>
  );
}
