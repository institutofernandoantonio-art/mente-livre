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

  const { data } = await supabase.auth.getClaims();

  const SESSION_REQUIRED_PATHS = new Set(['/mfa/configurar', '/mfa/verificar']);
  const AAL2_REQUIRED_PATHS = new Set([
    '/entrada',
    '/redefinir-senha',
    '/conversa',
    '/tarefas',
    '/hoje',
    '/resumo',
  ]);

  const pathname = request.nextUrl.pathname;
  const needsSession = SESSION_REQUIRED_PATHS.has(pathname) || AAL2_REQUIRED_PATHS.has(pathname);

  if (needsSession && !data) {
    const redirectResponse = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  if (AAL2_REQUIRED_PATHS.has(pathname) && data && data.claims.aal !== 'aal2') {
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();

    if (factorsError) {
      const redirectResponse = NextResponse.redirect(new URL('/login', request.url));
      response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
      return redirectResponse;
    }

    if (factors.totp.length > 0) {
      const redirectResponse = NextResponse.redirect(
        new URL(`/mfa/verificar?next=${encodeURIComponent(pathname)}`, request.url),
      );
      response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
      return redirectResponse;
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
