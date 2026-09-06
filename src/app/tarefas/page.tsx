import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button, buttonVariants } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/server';
import { statusLabel, formatDeadline } from './presentation';
import { completeTaskAction, cancelTaskAction } from './actions';
import { setTaskPriorityAction, type TaskPriority } from './priority-actions';

type TaskRow = {
  id: string;
  title: string;
  status: string;
  deadline_at: string | null;
  priority: TaskPriority | null;
};

const priorityOptions: Array<{ value: TaskPriority; label: string }> = [
  { value: 'alta', label: 'Alta' },
  { value: 'média', label: 'Média' },
  { value: 'baixa', label: 'Baixa' },
];

const priorityRank: Record<TaskPriority, number> = {
  alta: 0,
  média: 1,
  baixa: 2,
};

function priorityLabel(priority: TaskPriority | null) {
  if (!priority) return 'Sem prioridade';
  return priority === 'alta' ? 'Prioridade alta' : priority === 'média' ? 'Prioridade média' : 'Prioridade baixa';
}

function taskOrder(task: TaskRow) {
  if (task.status !== 'pending') return 10;
  return task.priority ? priorityRank[task.priority] : 3;
}

export default async function TarefasPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;

  let tasks: TaskRow[] = [];
  let loadFailed = false;

  if (typeof userId === 'string' && userId) {
    const { data, error } = await supabase
      .from('items')
      .select('id, title, status, deadline_at, priority')
      .eq('user_id', userId)
      .eq('needs_confirmation', false)
      .order('created_at', { ascending: false });

    if (error || data === null) {
      loadFailed = true;
    } else {
      tasks = [...data].sort((a, b) => taskOrder(a) - taskOrder(b));
    }
  } else {
    loadFailed = true;
  }

  const focusTasks = tasks.filter((task) => taskOrder(task) < 3).slice(0, 3);

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-center text-lg font-semibold text-ink">Minhas tarefas</h1>
        <p className="mb-6 text-center text-sm text-ink-soft">
          Defina o que merece sua atenção primeiro.
        </p>

        {loadFailed && <ErrorState message="Não foi possível carregar suas tarefas agora." />}

        {!loadFailed && tasks.length === 0 && <EmptyState title="Você ainda não tem tarefas." />}

        {!loadFailed && focusTasks.length > 0 && (
          <Card className="mb-4 flex flex-col gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Foco agora</p>
              <h2 className="mt-1 font-semibold text-ink">Até 3 prioridades para avançar</h2>
            </div>
            <ol className="flex flex-col gap-2">
              {focusTasks.map((task, index) => (
                <li key={`focus-${index}`} className="rounded-xl border border-mist-200 p-3">
                  <p className="text-xs font-medium text-ink-soft">
                    {index === 0 ? 'Missão principal sugerida' : `Prioridade ${index + 1}`}
                  </p>
                  <p className="mt-1 font-medium text-ink">{task.title}</p>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {!loadFailed && tasks.length > 0 && (
          <Card className="flex flex-col gap-3">
            {tasks.map((task) => {
              const deadlineText = formatDeadline(task.deadline_at);
              return (
                <div key={task.id} className="rounded-xl border border-mist-200 p-4">
                  <p className="font-medium text-ink">{task.title}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-soft">
                    <span>{statusLabel(task.status)}</span>
                    <span>{priorityLabel(task.priority)}</span>
                  </div>
                  {deadlineText && <p className="mt-1 text-sm text-ink-soft">Prazo: {deadlineText}</p>}

                  {task.status === 'pending' && (
                    <>
                      <div className="mt-3">
                        <p className="mb-2 text-xs font-medium text-ink-soft">Prioridade</p>
                        <div className="flex flex-wrap gap-2">
                          {priorityOptions.map((option) => (
                            <form
                              key={option.value}
                              action={setTaskPriorityAction.bind(null, task.id, option.value)}
                            >
                              <Button
                                type="submit"
                                variant={task.priority === option.value ? 'secondary' : 'ghost'}
                              >
                                {option.label}
                              </Button>
                            </form>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3 flex gap-2 border-t border-mist-200 pt-3">
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
                    </>
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
