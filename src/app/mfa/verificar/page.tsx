import { redirect } from 'next/navigation';
import { LogoMark } from '@/components/LogoMark';
import { Card } from '@/components/ui/Card';
import { createClient } from '@/lib/supabase/server';
import { VerifyMfaForm } from './VerifyMfaForm';

// Mesma allow-list fechada usada em src/proxy.ts e em verifyMfaChallenge()
// (src/lib/supabase/actions.ts) — nunca um destino arbitrário da URL.
const MFA_NEXT_ALLOWED_PATHS = new Set(['/entrada', '/redefinir-senha']);

export default async function VerificarMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const rawNext = typeof params.next === 'string' ? params.next : undefined;
  const next = rawNext && MFA_NEXT_ALLOWED_PATHS.has(rawNext) ? rawNext : '/entrada';

  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  if (claimsData?.claims.aal === 'aal2') {
    // Sessão já está em AAL2 — nada para verificar.
    redirect(next);
  }

  // listFactors() é server-verified (sempre passa por getUser()) — nunca
  // confia em dado de sessão vindo só do cookie local.
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error || !factors || factors.totp.length === 0) {
    // Só alcançável por navegação direta (o proxy só manda pra cá quando
    // já confirmou que existe fator verificado) — sem fator, não há o que
    // verificar.
    redirect('/entrada');
  }

  const factorId = factors.totp[0].id;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center">
        <LogoMark className="h-8 w-10" />
        <h1 className="mt-4 text-xl font-semibold text-ink">
          Verificação em duas etapas
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Digite o código do seu aplicativo autenticador.
        </p>

        <Card className="mt-8 w-full">
          <VerifyMfaForm factorId={factorId} next={next} />
        </Card>
      </div>
    </main>
  );
}
