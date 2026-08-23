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

  // Rotas que só exigem sessão válida (AAL1 basta) — /mfa/verificar
  // precisa ficar fora do grupo abaixo, senão uma sessão pendente de
  // segundo fator nunca conseguiria alcançar a própria tela de verificação.
  const SESSION_REQUIRED_PATHS = new Set(['/mfa/configurar', '/mfa/verificar']);
  // Rotas que exigem AAL2 quando a conta tiver um fator TOTP verificado
  // (/redefinir-senha inclusive — sem isso, o link de recuperação por
  // e-mail sozinho bastaria para trocar a senha de uma conta com MFA).
  const AAL2_REQUIRED_PATHS = new Set(['/entrada', '/redefinir-senha']);

  const pathname = request.nextUrl.pathname;
  const needsSession = SESSION_REQUIRED_PATHS.has(pathname) || AAL2_REQUIRED_PATHS.has(pathname);

  if (needsSession && !data) {
    const redirectResponse = NextResponse.redirect(new URL('/login', request.url));
    // Preserva qualquer cookie que o `setAll` já tenha gravado em `response`
    // (ex.: limpeza de um cookie de sessão inválido durante um refresh que
    // falhou), para o navegador não continuar enviando um cookie obsoleto.
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  if (AAL2_REQUIRED_PATHS.has(pathname) && data && data.claims.aal !== 'aal2') {
    // listFactors() sempre passa por getUser() no servidor — nunca confia
    // no `user.factors` do cookie local (editável pelo próprio usuário,
    // já que os cookies deste projeto não são httpOnly).
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();

    if (factorsError) {
      // Fail-closed: se não dá para confirmar se a conta tem MFA, nunca
      // deixa passar. Sem log aqui de propósito — decisão explícita desta
      // etapa. /login não tem checagem de AAL2, então não há loop.
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
    // Sem fator TOTP verificado: a conta não usa MFA, AAL1 é suficiente.
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
