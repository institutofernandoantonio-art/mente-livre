import { LogoMark } from '@/components/LogoMark';
import { Card } from '@/components/ui/Card';
import { createClient } from '@/lib/supabase/server';
import { EnrollMfaForm } from './EnrollMfaForm';

export default async function ConfigurarMfaPage() {
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const alreadyConfigured = (factors?.totp.length ?? 0) > 0;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center">
        <LogoMark className="h-8 w-10" />
        <h1 className="mt-4 text-xl font-semibold text-ink">Autenticação em duas etapas</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Adicione uma camada extra de segurança com um aplicativo
          autenticador.
        </p>

        <Card className="mt-8 w-full">
          {alreadyConfigured ? (
            <p role="status" className="text-center text-sm text-ink-soft">
              Você já tem um autenticador configurado.
            </p>
          ) : (
            <EnrollMfaForm />
          )}
        </Card>
      </div>
    </main>
  );
}
