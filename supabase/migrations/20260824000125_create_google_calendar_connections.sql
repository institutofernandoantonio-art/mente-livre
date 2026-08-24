create table public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  refresh_token text not null,
  created_at timestamptz not null default now()
);

comment on table public.google_calendar_connections is
  'Conexão do usuário com o Google Calendar (Fase 7B). Guarda só o
   refresh_token do Google — o access_token nunca é persistido, é gerado
   sob demanda a partir do refresh_token quando necessário. Uma conexão por
   usuário (user_id unique). Nesta fase a tabela é somente-gravação: não
   existe política de SELECT/UPDATE/DELETE de propósito, para eliminar
   qualquer caminho de leitura do refresh_token pelo cliente, mesmo via
   RLS mal configurada em código futuro. Leitura acontece só server-side,
   dentro das Server Actions que efetivamente chamam a API do Google.';

alter table public.google_calendar_connections enable row level security;

revoke all on public.google_calendar_connections from anon;

-- Só INSERT é concedido — nenhum SELECT/UPDATE/DELETE nesta fase (ver
-- comentário da tabela). Reconexão/atualização fica para uma fase futura.
grant insert
on public.google_calendar_connections
to authenticated;

create policy google_calendar_connections_insert_own
  on public.google_calendar_connections
  for insert
  to authenticated
  with check (auth.uid() = user_id);
