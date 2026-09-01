'use server';
import 'server-only';

import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { headers, cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GOOGLE_CALENDAR_REQUIRED_SCOPES } from './calendar-scopes';

// Escopos solicitados, concatenados com espaço (formato exigido pelo
// parâmetro `scope` da URL de autorização) — a partir da ÚNICA lista
// centralizada em `./calendar-scopes.ts` (ver aquele arquivo para a
// justificativa completa de cada escopo e por que vive separado deste:
// `calendar.ts` é um arquivo `'use server'`, que só pode exportar funções
// async, nunca uma constante). Este módulo NUNCA reexporta a lista —
// quem precisar dela (o callback do OAuth) importa diretamente de
// `./calendar-scopes`.
const GOOGLE_CALENDAR_SCOPES = GOOGLE_CALENDAR_REQUIRED_SCOPES.join(' ');

const STATE_COOKIE_NAME = 'google_calendar_oauth_state';
const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

// Conecta o Google Calendar à conta já autenticada — OAuth 2.0
// Authorization Code direto contra o Google, deliberadamente SEM passar
// pelo Supabase Auth (nunca linkIdentity()/signInWithOAuth() para isto).
// "Entrar com Google" e "Conectar Google Calendar" são identidades
// diferentes por design: usar linkIdentity() aqui falharia sempre que a
// conta Google escolhida já estivesse vinculada a OUTRA conta do Mente
// Livre (erro identity_already_exists, já reproduzido em teste real) —
// este fluxo nunca toca em auth.identities, então essa colisão não pode
// mais acontecer. Ver docs/DECISIONS.md, Fase 7B.
export async function connectGoogleCalendar() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();

  if (!claims?.claims.sub) {
    // Sem sessão válida — não deveria acontecer partindo de /entrada (já
    // protegida por src/proxy.ts), mas nunca prossegue sem isso mesmo assim.
    redirect('/entrada?calendar=error');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    redirect('/entrada?calendar=error');
  }

  const origin = (await headers()).get('origin');
  const redirectUri = `${origin}/conectar-google-calendar/callback`;

  // Uso único, alta entropia — validado e apagado no callback.
  const state = randomBytes(32).toString('base64url');

  (await cookies()).set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    path: '/conectar-google-calendar',
  });

  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES);
  authorizeUrl.searchParams.set('access_type', 'offline');
  authorizeUrl.searchParams.set('prompt', 'consent');
  authorizeUrl.searchParams.set('state', state);

  redirect(authorizeUrl.toString());
}

export type GoogleCalendarBusyBlock = {
  start: string;
  end: string;
};

// Renova o access token a partir do refresh_token guardado — nunca
// persistido, vive só nesta função, descartado ao final da chamada.
async function refreshGoogleAccessToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const accessToken =
    typeof payload === 'object' && payload !== null && 'access_token' in payload
      ? (payload as { access_token?: unknown }).access_token
      : undefined;

  return typeof accessToken === 'string' && accessToken ? accessToken : null;
}

// Deriva o access token do Google do usuário AUTENTICADO ATUAL — único
// ponto do projeto que toca `google_calendar_connections`/admin client
// para obter um access token. Extraído nesta subfase (Subfase 6 da
// criação de compromissos no Google Calendar) de dentro de
// `getGoogleCalendarBusyTimes`, sem nenhuma mudança de comportamento —
// reaproveitado também pela futura escrita de eventos
// (`src/lib/conversation/calendar-event-execution.ts`), que NUNCA duplica
// esta lógica de OAuth/refresh/lookup. Retorna null em qualquer falha
// (sem sessão, sem conexão, refresh inválido) — mesmo padrão de falha
// silenciosa/genérica já usado no resto do projeto; nunca lança, nunca
// distingue os motivos para quem chama.
export async function getGoogleCalendarAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;

  if (!userId) {
    return null;
  }

  // authenticated/anon não têm SELECT nesta tabela, de propósito (ver
  // docs/DECISIONS.md) — só o cliente privilegiado (chave secreta,
  // ignora RLS) consegue ler, e só depois de já termos o userId
  // verificado acima. O filtro por user_id abaixo nunca pode ser
  // removido: é ele, não a RLS, quem impede ler a linha de outro usuário
  // nesta consulta específica.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    // Configuração ausente/inválida é um erro de ambiente do servidor —
    // nunca exposto ao usuário, tratado como qualquer outra falha desta
    // função.
    return null;
  }

  const { data: connection, error: connectionError } = await admin
    .from('google_calendar_connections')
    .select('refresh_token')
    .eq('user_id', userId)
    .single();

  if (connectionError || !connection) {
    return null;
  }

  return refreshGoogleAccessToken(connection.refresh_token);
}

// Consulta só os blocos ocupados do calendário primário do usuário atual,
// numa janela [timeMin, timeMax) — nunca título/descrição/participantes/
// local/id do evento (freebusy.query nem devolve isso). Nada é persistido
// nem cacheado; cada chamada busca em tempo real. Retorna null em
// qualquer falha (sem conexão, refresh inválido, erro da API) — mesmo
// padrão de falha silenciosa/genérica já usado no resto do projeto.
export async function getGoogleCalendarBusyTimes(
  timeMin: string,
  timeMax: string,
): Promise<GoogleCalendarBusyBlock[] | null> {
  const accessToken = await getGoogleCalendarAccessToken();
  if (!accessToken) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ timeMin, timeMax, items: [{ id: 'primary' }] }),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const primaryCalendar =
    typeof payload === 'object' && payload !== null && 'calendars' in payload
      ? (payload as { calendars?: Record<string, unknown> }).calendars?.primary
      : undefined;

  if (typeof primaryCalendar !== 'object' || primaryCalendar === null) {
    return null;
  }

  const errors = (primaryCalendar as { errors?: unknown }).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return null;
  }

  const busy = (primaryCalendar as { busy?: unknown }).busy;
  if (!Array.isArray(busy)) {
    return null;
  }

  // Nunca confia na resposta bruta — só start/end string sobrevivem;
  // qualquer outro campo eventualmente presente é descartado aqui mesmo.
  const blocks: GoogleCalendarBusyBlock[] = [];
  for (const item of busy) {
    const start = typeof item === 'object' && item !== null ? (item as { start?: unknown }).start : undefined;
    const end = typeof item === 'object' && item !== null ? (item as { end?: unknown }).end : undefined;
    if (typeof start === 'string' && typeof end === 'string') {
      blocks.push({ start, end });
    }
  }

  return blocks;
}
