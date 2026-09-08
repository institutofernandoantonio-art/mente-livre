import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/lib/supabase/actions";
import { connectGoogleCalendar } from "@/lib/google/calendar";
import { buildGoogleCalendarAccountUrl } from "@/lib/google/calendar-web-url";
import { BrainDumpForm } from "./BrainDumpForm";
import { UpcomingCalendarEvents } from "./UpcomingCalendarEvents";

/**
 * Tela legada de despejo mental. No fluxo normal, a conversa é o centro do
 * produto; esta rota só permanece visível quando precisa apresentar o retorno
 * específico da conexão com o Google Calendar.
 */
export default async function EntradaPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const { calendar } = await searchParams;
  if (calendar === undefined) {
    redirect("/conversa");
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === "string" ? data.claims.email : undefined;
  const calendarUrl = buildGoogleCalendarAccountUrl(email ?? "");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        {email && (
          <p className="mb-6 text-center text-sm text-ink-soft">
            Sessão ativa: <span className="font-medium text-ink">{email}</span>
          </p>
        )}

        {calendar === "connected" && (
          <p role="status" className="mb-4 text-center text-sm text-ink-soft">
            Google Calendar conectado.
          </p>
        )}
        {calendar === "error" && (
          <p role="alert" className="mb-4 text-center text-sm text-alert-500">
            Não foi possível conectar ao Google Calendar. Tente novamente.
          </p>
        )}
        {calendar === "permissions" && (
          <p role="alert" className="mb-4 text-center text-sm text-alert-500">
            Para agendar compromissos, o Mente Livre precisa da permissão de criar eventos no seu Google Agenda.
          </p>
        )}

        <Card>
          <BrainDumpForm />
        </Card>

        {email && <UpcomingCalendarEvents calendarUrl={calendarUrl} accountEmail={email} />}

        <div className="mt-6 flex flex-col items-center gap-3">
          <Link href="/conversa" className={buttonVariants("secondary")}>
            Conversar com o Mente Livre
          </Link>
          <Link href="/" className={buttonVariants("secondary")}>
            Voltar ao início
          </Link>
          {email && (
            <Link href="/mfa/configurar" className={buttonVariants("ghost")}>
              Configurar autenticação em duas etapas
            </Link>
          )}
          {email && (
            <form action={connectGoogleCalendar}>
              <button type="submit" className={buttonVariants("ghost")}>
                Conectar Google Calendar
              </button>
            </form>
          )}
          {email && (
            <form action={logout}>
              <button type="submit" className={buttonVariants("ghost")}>
                Sair
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
