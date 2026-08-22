import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      redirect('/entrada');
    }
  }

  // Código ausente, inválido, expirado ou já usado: mesma mensagem
  // genérica de qualquer outra falha de autenticação — nunca diferencia
  // o motivo específico.
  redirect('/login');
}
