-- Subfase 10 da criação de compromissos no Google Calendar: gate seguro
-- para conexões antigas freebusy-only — impede que uma conexão criada
-- ANTES da ampliação de escopo (Subfase 7, calendar.events.owned) chegue
-- ao CLAIM/`events.insert` só porque "existe um refresh_token válido".
--
-- ============================================================================
-- PROBLEMA RESOLVIDO
-- ============================================================================
--
-- Uma linha em `google_calendar_connections` sempre teve o MESMO shape,
-- não importa quando foi criada — uma conexão de antes da Subfase 7 (só
-- `calendar.events.freebusy` concedido) e uma conexão nova (também
-- `calendar.events.owned` concedido) são estruturalmente indistinguíveis
-- olhando só para "existe refresh_token". Sem um sinal explícito, o
-- orquestrador (`calendar-event-confirmation.ts`) só descobriria a
-- diferença DEPOIS do claim, ao receber 403/401 do próprio Google — um
-- estado de execução incerta perfeitamente evitável.
--
-- ============================================================================
-- SOLUÇÃO MÍNIMA — uma coluna booleana, zero tabela nova
-- ============================================================================
--
-- `event_write_enabled boolean not null default false` — nenhuma lista de
-- scopes armazenada, nenhum access_token, nenhuma resposta OAuth bruta,
-- nenhum sistema de permissões novo. `true` significa exatamente uma
-- coisa: "esta conexão foi (re)estabelecida depois de o callback já ter
-- confirmado TODOS os escopos obrigatórios desta V1, incluindo o de
-- escrita". `default false` já cobre, por construção, tanto conexões
-- FUTURAS inseridas por engano fora do fluxo esperado quanto — o caso que
-- interessa aqui — TODAS as conexões já existentes na tabela: um
-- `ALTER TABLE ADD COLUMN ... DEFAULT false` preenche a coluna com `false`
-- em toda linha já existente, sem tocar `refresh_token`/`created_at`/`id`
-- de nenhuma delas. Nenhum `UPDATE` é executado nesta migration.
--
-- ============================================================================
-- POR QUE A RPC ANTIGA (`reconnect_google_calendar`) NÃO PRECISA MUDAR
-- ============================================================================
--
-- A produção antiga (ainda sem os commits desta subfase) continua
-- chamando `reconnect_google_calendar(p_refresh_token)` — essa função
-- (migration 20260831020000, NÃO tocada aqui) faz:
--
--   insert into public.google_calendar_connections (user_id, refresh_token)
--   values (v_user_id, p_refresh_token)
--   on conflict (user_id) do update set refresh_token = excluded.refresh_token;
--
-- Repare: a cláusula `do update set` só toca a coluna `refresh_token` —
-- `event_write_enabled` NUNCA aparece ali. Isso significa, por construção
-- (sem precisar reescrever uma linha sequer daquela função):
--
--   - reconexão de uma linha JÁ existente: `event_write_enabled` mantém
--     seu valor ATUAL (nunca é tocado pelo `do update`);
--   - primeira conexão (INSERT puro, sem conflito): a coluna nem é citada
--     na lista de colunas do INSERT, então recebe o `DEFAULT false` da
--     tabela.
--
-- Ou seja: é estruturalmente IMPOSSÍVEL para `reconnect_google_calendar`
-- elevar qualquer conexão para `event_write_enabled = true` — não por uma
-- checagem nova, mas porque essa coluna simplesmente não existe no
-- vocabulário daquela função. Isso preserva o rollout seguro pedido:
-- antes do novo deploy, produção continua chamando a RPC antiga
-- livremente, e nenhuma conexão ganha escrita por acidente.
--
-- ============================================================================
-- NOVA RPC — `reconnect_google_calendar_with_event_write`
-- ============================================================================
--
-- IRMÃ de `reconnect_google_calendar`, mesmo padrão de segurança exato
-- (private SECURITY DEFINER + public SECURITY INVOKER, mesma validação de
-- auth.uid()/refresh_token não vazio, mesmo `on conflict (user_id) do
-- update`) — a ÚNICA diferença é que esta grava `event_write_enabled =
-- true` atomicamente, na MESMA instrução SQL que grava o refresh_token
-- (INSERT ou UPDATE, nunca duas operações separadas — não há como um
-- refresh_token novo ser salvo sem a flag, nem vice-versa).
--
-- Só o NOVO callback (`src/app/conectar-google-calendar/callback/route.ts`)
-- chama esta função, e só DEPOIS de já ter confirmado: token exchange
-- bem-sucedido, refresh_token presente, E todos os escopos obrigatórios
-- concedidos (freebusy + calendar.events.owned) — ver aquele arquivo. A
-- própria escolha de chamar ESTA função (em vez da antiga) já representa
-- essa validação: nenhum scope/boolean é passado como parâmetro aqui —
-- `p_refresh_token` continua sendo o único argumento, exatamente como na
-- função antiga.
--
-- `user_id` nunca é parâmetro — sempre `auth.uid()`, derivado dentro da
-- função, mesma disciplina de toda a pilha.
alter table public.google_calendar_connections
  add column event_write_enabled boolean not null default false;

comment on column public.google_calendar_connections.event_write_enabled is
  'true SOMENTE quando esta conexão foi (re)estabelecida depois de o
   callback confirmar TODOS os escopos obrigatórios, incluindo o de
   escrita (calendar.events.owned) — nunca setado por
   reconnect_google_calendar (a RPC antiga, mantida para compatibilidade
   com produção enquanto os novos commits não são deployados). Conexões
   existentes (criadas quando o app só pedia calendar.events.freebusy)
   ficam automaticamente false até reconectarem com o novo consentimento
   completo. Nunca reflete access_token/refresh_token/lista de scopes —
   só esta única capacidade booleana.';

-- ============================================================================
-- Nova função privilegiada (schema private) ------------------------------
-- ============================================================================
--
-- SECURITY DEFINER pelo MESMO motivo já documentado em
-- `private.reconnect_google_calendar` (20260831020000): um GRANT de
-- INSERT/UPDATE direto na tabela para `authenticated`, só para viabilizar
-- SECURITY INVOKER, exporia `google_calendar_connections` como endpoint
-- REST direto (Data API expõe qualquer tabela com grant, independente de
-- RLS) — sem nenhum benefício. `search_path` fixado em `''`, toda
-- referência a objeto schema-qualified — mesma disciplina de sempre.
create or replace function private.reconnect_google_calendar_with_event_write(p_refresh_token text)
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

  -- Atômico: refresh_token e event_write_enabled são gravados na MESMA
  -- instrução (INSERT ou, em caso de conflito, UPDATE) — nunca duas
  -- operações separadas que pudessem deixar a conexão num estado
  -- intermediário (token novo sem a flag, ou flag sem o token novo).
  insert into public.google_calendar_connections (user_id, refresh_token, event_write_enabled)
  values (v_user_id, p_refresh_token, true)
  on conflict (user_id) do update
    set refresh_token = excluded.refresh_token,
        event_write_enabled = true;
end;
$$;

revoke all on function private.reconnect_google_calendar_with_event_write(text) from public;
grant execute on function private.reconnect_google_calendar_with_event_write(text) to authenticated;

-- ============================================================================
-- Wrapper público (schema public, exposto pela Data API) -----------------
-- ============================================================================
--
-- Único ponto alcançável por
-- `supabase.rpc('reconnect_google_calendar_with_event_write', ...)`.
-- SECURITY INVOKER: não precisa de privilégio próprio, só repassa a
-- chamada — mesmo padrão exato do wrapper público já existente.
create or replace function public.reconnect_google_calendar_with_event_write(p_refresh_token text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.reconnect_google_calendar_with_event_write(p_refresh_token);
end;
$$;

revoke all on function public.reconnect_google_calendar_with_event_write(text) from public;
grant execute on function public.reconnect_google_calendar_with_event_write(text) to authenticated;

-- ============================================================================
-- Grants da tabela — inalterados, reafirmados explicitamente
-- ============================================================================
--
-- Esta migration NUNCA concede SELECT/UPDATE direto em
-- `google_calendar_connections` para `authenticated`/`anon` — a tabela
-- continua exatamente como as migrations anteriores a deixaram (só INSERT
-- para `authenticated`, ver 20260824000125; RLS habilitada; nenhuma
-- policy de SELECT/UPDATE/DELETE existe). Toda leitura de
-- `event_write_enabled` acontece SOMENTE server-side, via o mesmo admin
-- client privilegiado já usado por `getGoogleCalendarAccessToken`
-- (`../google/calendar`) — nunca um novo caminho de leitura pelo cliente.
