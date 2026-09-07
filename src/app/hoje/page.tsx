import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button, buttonVariants } from '@/components/ui/Button';
import { UpcomingCalendarEvents } from '@/app/entrada/UpcomingCalendarEvents';
import { createClient } from '@/lib/supabase/server';
import { buildGoogleCalendarAccountUrl } from '@/lib/google/calendar-web-url';
import { completeTaskAction } from '@/app/tarefas/actions';
import type { TaskPriority } from '@/app/tarefas/priority-actions';

type FocusTask = {
  id: string;
  title: string;
  priority: TaskPriority | null;
};

const priorityRank: Record<TaskPriority, number> = {
  alta: 0,
  média: 1,
  baixa: 2,
};

function focusOrder(task: FocusTask) {
  return task.priority ? priorityRank[task.priority] : 3;
}

export default async function HojePage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  const email = typeof claims?.claims.email === 'string' ? claims.claims.email : '';
  const calendarUrl = buildGoogleCalendarAccountUrl(email);

  let focusTasks: FocusTask[] = [];
  let loadFailed = false;

  if (typeof userId === 'string' && userId) {
    const { data, error } = await supabase
      .from('items')
      .select('id, title, priority')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('needs_confirmation', false)
      .order('created_at', { ascending: false });

    if (error || data === null) {
      loadFailed = true;
    } else {
      focusTasks = [...data]
        .filter((task) => task.priority !== null)
        .sort((a, b) => focusOrder(a) - focusOrder(b))
        .slice(0, 4);
    }
  } else {
    loadFailed = true;
  }

  const missionTitle = focusTasks[0]?.title ?? null;

  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Hoje</p>
          <h1 className="mt-1 text-xl font-semibold text-ink">Seu foco de agora</h1>
          <p className="mt-2 text-sm text-ink-soft">Uma missão principal e até três prioridades para avançar.</p>
        </div>

        {loadFailed && <ErrorState message="Não foi possível carregar seu foco agora." />}

        {!loadFailed && focusTasks.length === 0 && (
          <EmptyState title="Você ainda não definiu prioridades." />
        )}

        {!loadFailed && focusTasks.length > 0 && (
          <Card className="flex flex-col gap-3">
            <ol className="flex flex-col gap-3">
              {focusTasks.map((task, index) => (
                <li key={task.id} className="rounded-xl border border-mist-200 p-4">
                  <p className="text-xs font-medium text-ink-soft">
                    {index === 0 ? 'Missão principal sugerida' : `Prioridade ${index}`}
                  </p>
                  <p className="mt-1 font-medium text-ink">{task.title}</p>
                  <form action={completeTaskAction.bind(null, task.id)} className="mt-3">
                    <Button type="submit" variant="secondary">Concluir</Button>
                  </form>
                </li>
              ))}
            </ol>
          </Card>
        )}

        <UpcomingCalendarEvents
          calendarUrl={calendarUrl}
          accountEmail={email}
          focusTitle={missionTitle}
        />

        <div className="mt-6 flex flex-col items-center gap-3">
          <Link href="/tarefas" className={buttonVariants('secondary')}>
            Organizar prioridades
          </Link>
          <Link href="/conversa" className={buttonVariants('secondary')}>
            Conversar com o Mente Livre
          </Link>
        </div>
      </div>
    </main>
  );
}
