import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { buttonVariants } from '@/components/ui/Button';
import { BackButton } from '@/components/navigation/BackButton';
import { UpcomingCalendarEvents } from '@/app/entrada/UpcomingCalendarEvents';
import { createClient } from '@/lib/supabase/server';
import { buildGoogleCalendarAccountUrl } from '@/lib/google/calendar-web-url';
import { ConversationPanel } from './ConversationPanel';

/**
 * Rota isolada da UI conversacional. A conversa continua sendo o centro da
 * tela, com a agenda logo abaixo para reduzir trocas de contexto: próximos
 * compromissos, avisos de proximidade e atalho direto para o Google Agenda.
 */
export default async function ConversaPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === 'string' ? data.claims.email : '';
  const calendarUrl = buildGoogleCalendarAccountUrl(email);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex justify-start">
          <BackButton />
        </div>

        <Card>
          <ConversationPanel />
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
        </div>
      </div>
    </main>
  );
}
