import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Decodifica só o payload do JWT (sem verificar assinatura) para checar o
 * `role` embutido nele. Usado apenas como guarda de configuração — nunca
 * loga o valor da chave.
 */
function isServiceRoleKey(key: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString('utf8'));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (isServiceRoleKey(supabaseAnonKey)) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY parece ser uma service_role key. ' +
        'Nunca use a service_role neste arquivo (roda a cada requisição) ' +
        'nem em qualquer código exposto ao navegador — só a anon key.',
    );
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Valida a sessão no servidor via getClaims() — verifica o JWT (localmente
  // via JWKS quando o projeto usa chaves assimétricas, ou contra o servidor
  // de Auth caso contrário) em vez de confiar direto no conteúdo do cookie.
  // Isso também aciona o refresh do token quando necessário; o resultado é
  // gravado de volta na resposta pelo `setAll` acima. Nenhum dado da sessão
  // é logado. O mesmo resultado também decide, abaixo, se a rota exige
  // sessão — sem criar um segundo cliente ou uma segunda validação.
  const { data } = await supabase.auth.getClaims();

  // Rotas protegidas: exigem sessão válida (/redefinir-senha inclusive só é
  // alcançável com a sessão de recovery criada por /auth/callback).
  const protectedPaths = new Set(['/entrada', '/redefinir-senha']);
  if (protectedPaths.has(request.nextUrl.pathname) && !data) {
    const redirectResponse = NextResponse.redirect(new URL('/login', request.url));
    // Preserva qualquer cookie que o `setAll` já tenha gravado em `response`
    // (ex.: limpeza de um cookie de sessão inválido durante um refresh que
    // falhou), para o navegador não continuar enviando um cookie obsoleto.
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
