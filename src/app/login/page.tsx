import Link from 'next/link';
import { LogoMark } from '@/components/LogoMark';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { signInWithGoogle } from '@/lib/supabase/actions';
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

          <div className="my-4 flex items-center gap-3 text-xs text-ink-soft" aria-hidden="true">
            <span className="h-px flex-1 bg-mist-200" />
            ou
            <span className="h-px flex-1 bg-mist-200" />
          </div>

          <form action={signInWithGoogle}>
            <Button type="submit" variant="secondary" className="w-full">
              Entrar com Google
            </Button>
          </form>
        </Card>

        <div className="mt-6 flex flex-col items-center gap-2 text-sm text-ink-soft">
          <Link href="/esqueci-senha" className="underline underline-offset-2">
            Esqueci minha senha
          </Link>
          <Link href="/cadastro" className="underline underline-offset-2">
            Criar conta
          </Link>
        </div>
      </div>
    </main>
  );
}
