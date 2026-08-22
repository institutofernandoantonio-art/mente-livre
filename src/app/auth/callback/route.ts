import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Allow-list fechada de destinos pós-login: `next` nunca é usado direto
// como redirect (evita open redirect) — só serve para escolher entre estes
// dois caminhos fixos, nunca um valor arbitrário da URL.
const ALLOWED_NEXT_PATHS = new Set(['/entrada', '/redefinir-senha']);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');
  const destination = next && ALLOWED_NEXT_PATHS.has(next) ? next : '/entrada';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      redirect(destination);
    }
  }

  // Código ausente, inválido, expirado ou já usado: mesma mensagem
  // genérica de qualquer outra falha de autenticação — nunca diferencia
  // o motivo específico.
  redirect('/login');
}
