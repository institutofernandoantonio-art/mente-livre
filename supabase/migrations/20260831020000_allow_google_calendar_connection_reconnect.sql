-- Permite reconexão do Google Calendar: hoje `google_calendar_connections`
-- só concede INSERT a `authenticated` (ver migration original,
-- 20260824000125) — qualquer usuário que já tenha uma linha (reconectando
-- após já ter conectado antes) recebe `23505 unique_violation` no INSERT,
-- mascarado pelo callback como o mesmo erro genérico de qualquer outra
-- falha (bug real confirmado em produção, ver relatório de diagnóstico
-- correspondente).
--
-- Desenho escolhido — função privilegiada em schema NÃO exposto, não
-- upsert direto pelo client: um `upsert` direto do client exigiria dar a
-- `authenticated` GRANT de UPDATE na tabela (e, por causa da RLS avaliar a
-- cláusula USING/WITH CHECK sobre `user_id`, também SELECT(user_id)) — e
-- qualquer GRANT de tabela para `authenticated` é automaticamente exposto
-- pela Data API do Supabase (PostgREST) como endpoint REST direto
-- (`PATCH .../google_calendar_connections`), alcançável por qualquer
-- código no browser com sessão válida, não só pelo callback. A rota
-- escolhida aqui evita isso por completo: nenhum GRANT novo de
-- SELECT/UPDATE/DELETE é concedido na tabela para `authenticated` — a
-- única modificação possível na tabela passa por uma função estreita,
-- auditável em poucas linhas.
--
-- `private.reconnect_google_calendar`: SECURITY DEFINER, dona é quem
-- aplica a migration (privilégio efetivo de dono da tabela, contorna RLS
-- só dentro desta função) — faz o INSERT/UPDATE atômico via
-- `ON CONFLICT (user_id) DO UPDATE`. Fica no schema `private`
-- (criado por esta migration), que NUNCA aparece em `api.schemas` do
-- `supabase/config.toml` (hoje: só `public` e `graphql_public`) — logo
-- nunca é alcançável via Data API/PostgREST, nem mesmo via
-- `supabase.rpc(...)` do client normal, que só resolve funções do(s)
-- schema(s) expostos. `user_id` nunca é parâmetro: é sempre `auth.uid()`,
-- lido de dentro da função — um client nunca pode pedir para gravar a
-- conexão de outro usuário, porque não há como esse "outro usuário" ser
-- sequer expressável na chamada. Rejeita explicitamente `auth.uid()` nulo
-- e refresh_token vazio antes de tocar a tabela.
--
-- `public.reconnect_google_calendar`: wrapper fino, SECURITY INVOKER (não
-- DEFINER — não precisa de privilégio extra, só repassa a chamada), no
-- schema `public` (esse sim exposto) — é o único ponto alcançável por
-- `supabase.rpc('reconnect_google_calendar', { p_refresh_token })` a
-- partir do callback. Não contém nenhuma lógica além de chamar a função
-- privada; não retorna nada sensível (aliás não retorna nada — `void`).
--
-- Nenhuma das duas funções retorna o token ou a linha. Nenhum GRANT de
-- SELECT/UPDATE/DELETE é concedido na tabela para `authenticated`/`anon`
-- por esta migration — a tabela continua exatamente como a migration
-- original a deixou (somente-INSERT para `authenticated`, sem leitura
-- possível pelo cliente). Nenhum DELETE é introduzido em lugar nenhum.
-- Nenhum uso de service_role/admin client — tudo roda através do client
-- Supabase autenticado normal do callback, chamando a função pública via
-- RPC.
--
-- search_path fixado em '' nas duas funções (mesma disciplina já usada em
-- public.confirm_create_local_task e public.handle_new_user) — toda
-- referência a objeto é schema-qualified (`public.google_calendar_connections`,
-- `private.reconnect_google_calendar`, `auth.uid()`), nunca depende de
-- resolução implícita de nomes.

-- 1. Schema privado -----------------------------------------------------
-- Não exposto pela Data API (não está em `api.schemas` do
-- supabase/config.toml, que hoje lista só `public` e `graphql_public`) —
-- é assim, e não por um GRANT/REVOKE específico, que a função privilegiada
-- fica inalcançável via REST/RPC do client. O REVOKE/GRANT de USAGE abaixo
-- é defesa em profundidade explícita (mesmo estilo de "explícito em vez de
-- implícito" já usado no restante do projeto), não a proteção primária.

create schema if not exists private;

revoke all on schema private from public;

-- `authenticated` precisa de USAGE aqui só porque o wrapper público
-- (SECURITY INVOKER) chama a função privada sob o próprio papel de quem
-- invocou — sem USAGE nesse schema, essa chamada interna falharia por
-- permissão. Isso nunca torna o schema alcançável via Data API: PostgREST
-- só expõe schemas listados em `api.schemas`, nunca resolve chamadas para
-- fora dessa lista, independente de GRANTs internos do Postgres.
grant usage on schema private to authenticated;

-- 2. Função privilegiada (schema private) --------------------------------

create or replace function private.reconnect_google_calendar(p_refresh_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using message = 'not authenticated';
  end if;

  if p_refresh_token is null or length(trim(p_refresh_token)) = 0 then
    raise exception using message = 'invalid refresh token';
  end if;

  insert into public.google_calendar_connections (user_id, refresh_token)
  values (v_user_id, p_refresh_token)
  on conflict (user_id) do update set refresh_token = excluded.refresh_token;
end;
$$;

revoke all on function private.reconnect_google_calendar(text) from public;
grant execute on function private.reconnect_google_calendar(text) to authenticated;

-- 3. Wrapper público (schema public, exposto pela Data API) --------------
-- Único ponto chamável por `supabase.rpc('reconnect_google_calendar', ...)`
-- a partir do callback. SECURITY INVOKER: não precisa de privilégio
-- próprio nenhum, só repassa a chamada — toda a autoridade real está na
-- função privada acima.

create or replace function public.reconnect_google_calendar(p_refresh_token text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.reconnect_google_calendar(p_refresh_token);
end;
$$;

revoke all on function public.reconnect_google_calendar(text) from public;
grant execute on function public.reconnect_google_calendar(text) to authenticated;
