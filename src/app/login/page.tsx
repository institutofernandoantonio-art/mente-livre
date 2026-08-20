import { LogoMark } from '@/components/LogoMark';
import { Card } from '@/components/ui/Card';
import { LoginForm } from './LoginForm';

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center">
        <LogoMark className="h-8 w-10" />
        <h1 className="mt-4 text-xl font-semibold text-ink">Entrar</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Use o email e a senha da sua conta Mente Livre.
        </p>

        <Card className="mt-8 w-full">
          <LoginForm />
        </Card>
      </div>
    </main>
  );
}
