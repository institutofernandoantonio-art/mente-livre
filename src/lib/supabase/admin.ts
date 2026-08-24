import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Cliente privilegiado, só server-side — nunca herda sessão/JWT/cookies do
// usuário, nunca aplica RLS. `import 'server-only'` faz o build falhar se
// este módulo for importado, mesmo por engano, de código alcançável por
// um Client Component. Uso estritamente contido à leitura de
// google_calendar_connections (ver src/lib/google/calendar.ts) — nunca
// generalizar para outra tabela/operação sem necessidade nova e aprovada.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    // Falha explícita, de propósito: ausência de configuração aqui é um
    // erro de ambiente, não uma falha de usuário — nunca deve passar
    // silenciosamente. A mensagem não interpola nenhum valor de segredo.
    throw new Error('Supabase admin client is not configured.');
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
