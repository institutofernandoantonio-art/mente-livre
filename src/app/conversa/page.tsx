import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { buttonVariants } from '@/components/ui/Button';
import { UpcomingCalendarEvents } from '@/app/entrada/UpcomingCalendarEvents';
import { ConversationPanel } from './ConversationPanel';

/**
 * Rota isolada da UI conversacional. A conversa continua sendo o centro da
 * tela, com a agenda logo abaixo para reduzir trocas de contexto: próximos
 * compromissos, avisos de proximidade e atalho direto para o Google Agenda.
 */
export default function ConversaPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Card>
          <ConversationPanel />
        </Card>

        <UpcomingCalendarEvents />

        <div className="mt-6 flex flex-col items-center gap-3">
          <a
            href="https://calendar.google.com/calendar/u/0/r"
            target="_blank"
            rel="noreferrer"
            className={buttonVariants('primary')}
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
