import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { buttonVariants } from '@/components/ui/Button';
import { UpcomingCalendarEvents } from '@/app/entrada/UpcomingCalendarEvents';
import { createClient } from '@/lib/supabase/server';
import { buildGoogleCalendarAccountUrl } from '@/lib/google/calendar-web-url';
import { ConversationPanel } from './ConversationPanel';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ConversaPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  const email = typeof data?.claims.email === 'string' ? data.claims.email : '';
  const calendarUrl = buildGoogleCalendarAccountUrl(email);

  let scheduleTaskTitle: string | null = null;
  const params = await searchParams;
  const rawTaskId = params.agendarTask;
  const taskId = typeof rawTaskId === 'string' ? rawTaskId.trim() : '';

  if (taskId && typeof userId === 'string' && userId) {
    const { data: task } = await supabase
      .from('items')
      .select('title')
      .eq('id', taskId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('needs_confirmation', false)
      .maybeSingle();

    if (task && typeof task.title === 'string' && task.title.trim()) {
      scheduleTaskTitle = task.title.trim();
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Card>
          <ConversationPanel scheduleTaskTitle={scheduleTaskTitle} />
        </Card>

        <UpcomingCalendarEvents calendarUrl={calendarUrl} accountEmail={email} />

        <div className="mt-6 flex flex-col items-center gap-3">
          <Link href="/hoje" className={buttonVariants('primary')}>
            Ver meu foco de hoje
          </Link>
          <a
            href={calendarUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants('secondary')}
          >
            Abrir Google Agenda
          </a>
          <Link href="/tarefas" className={buttonVariants('secondary')}>
            Minhas tarefas
          </Link>
          <Link href="/entrada" className={buttonVariants('secondary')}>
            Voltar para entrada
          </Link>
        </div>
      </div>
    </main>
  );
}
