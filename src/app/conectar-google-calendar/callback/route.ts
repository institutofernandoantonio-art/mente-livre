import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const STATE_COOKIE_NAME = 'google_calendar_oauth_state';

// Callback do OAuth direto do Google Calendar — deliberadamente sem
// exchangeCodeForSession(): a sessão do Mente Livre já existe e nunca é
// recriada aqui, só lida (getClaims()) para confirmar quem é o usuário.
// A troca do código é feita nós mesmos, direto com o Google. Nenhum
// token/segredo aparece em log, resposta ou na URL de redirecionamento.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const cookieStore = await cookies();
  const storedState = cookieStore.get(STATE_COOKIE_NAME)?.value;
  // Uso único: apaga já, independentemente do resultado da validação.
  cookieStore.delete(STATE_COOKIE_NAME);

  if (!code || !state || !storedState || state !== storedState) {
    redirect('/entrada?calendar=error');
  }

  const supabase = await createClient();

  // user_id só da sessão já autenticada, verificada no servidor — nunca
  // do cliente. Esta troca nunca cria nem modifica a sessão do Mente Livre.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;

  if (!userId) {
    redirect('/entrada?calendar=error');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    redirect('/entrada?calendar=error');
  }

  // Precisa ser exatamente a mesma string usada na autorização — derivada
  // da própria URL da requisição, não de um header Origin (nem sempre
  // presente numa navegação GET de topo vinda de outro site).
  const redirectUri = `${url.origin}/conectar-google-calendar/callback`;

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
  } catch {
    // Falha de rede ao trocar o código — tratada como falha genérica,
    // nunca propagada como erro técnico ao usuário.
    redirect('/entrada?calendar=error');
  }

  if (!tokenResponse.ok) {
    redirect('/entrada?calendar=error');
  }

  let tokenPayload: unknown;
  try {
    tokenPayload = await tokenResponse.json();
  } catch {
    redirect('/entrada?calendar=error');
  }

  const refreshToken =
    typeof tokenPayload === 'object' && tokenPayload !== null && 'refresh_token' in tokenPayload
      ? (tokenPayload as { refresh_token?: unknown }).refresh_token
      : undefined;

  // access_type=offline + prompt=consent deveriam garantir um
  // refresh_token nesta troca; se não vier, não persiste conexão
  // incompleta — access_token (se vier) nunca é lido nem usado aqui.
  if (typeof refreshToken !== 'string' || !refreshToken) {
    redirect('/entrada?calendar=error');
  }

  // RPC (não insert/upsert direto na tabela): permite tanto a primeira
  // conexão quanto reconectar uma conta que já tinha uma linha — sem isso,
  // uma reconexão sempre falhava com `23505 unique_violation` (user_id é
  // unique), mascarado como o mesmo erro genérico de qualquer outra causa
  // (bug real confirmado em produção). `user_id` nunca é enviado por este
  // código — a função (public.reconnect_google_calendar, que só repassa
  // para private.reconnect_google_calendar, migration 20260831020000)
  // deriva o usuário de auth.uid() internamente; este client nunca tem
  // (e não precisa ter) nenhum GRANT de SELECT/UPDATE/DELETE na tabela.
  const { error: rpcError } = await supabase.rpc('reconnect_google_calendar', {
    p_refresh_token: refreshToken,
  });

  if (rpcError) {
    redirect('/entrada?calendar=error');
  }

  redirect('/entrada?calendar=connected');
}
