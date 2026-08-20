import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Chamado durante a renderização de um Server Component, onde
            // cookies() não permite `set` (ver next/headers). O refresh de
            // sessão por requisição fica a cargo de src/proxy.ts, ainda não
            // implementado nesta fase — sem ele, sessões perto de expirar
            // não serão renovadas automaticamente entre requisições.
          }
        },
      },
    },
  );
}
