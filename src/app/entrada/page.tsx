import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/lib/supabase/actions";
import { BrainDumpForm } from "./BrainDumpForm";

/**
 * Tela 2 (despejo mental) — Fase 3: captura de texto livre. Também é o
 * destino pós-login da Fase 2 (ver docs/DECISIONS.md): mostra a sessão
 * ativa e o logout.
 */
export default async function EntradaPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === "string" ? data.claims.email : undefined;

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        {email && (
          <p className="mb-6 text-center text-sm text-ink-soft">
            Sessão ativa: <span className="font-medium text-ink">{email}</span>
          </p>
        )}

        <Card>
          <BrainDumpForm />
        </Card>

        <div className="mt-6 flex flex-col items-center gap-3">
          <Link href="/" className={buttonVariants("secondary")}>
            Voltar ao início
          </Link>
          {email && (
            <Link href="/mfa/configurar" className={buttonVariants("ghost")}>
              Configurar autenticação em duas etapas
            </Link>
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
