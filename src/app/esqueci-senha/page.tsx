import Link from 'next/link';
import { LogoMark } from '@/components/LogoMark';
import { Card } from '@/components/ui/Card';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export default function EsqueciSenhaPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center">
        <LogoMark className="h-8 w-10" />
        <h1 className="mt-4 text-xl font-semibold text-ink">Esqueci minha senha</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Informe o email da sua conta para receber um link de redefinição.
        </p>

        <Card className="mt-8 w-full">
          <ForgotPasswordForm />
        </Card>

        <Link href="/login" className="mt-6 text-sm text-ink-soft underline underline-offset-2">
          Voltar para o login
        </Link>
      </div>
    </main>
  );
}
