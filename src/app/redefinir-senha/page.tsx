import { LogoMark } from '@/components/LogoMark';
import { Card } from '@/components/ui/Card';
import { ResetPasswordForm } from './ResetPasswordForm';

export default function RedefinirSenhaPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center">
        <LogoMark className="h-8 w-10" />
        <h1 className="mt-4 text-xl font-semibold text-ink">Nova senha</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Defina uma nova senha para a sua conta Mente Livre.
        </p>

        <Card className="mt-8 w-full">
          <ResetPasswordForm />
        </Card>
      </div>
    </main>
  );
}
