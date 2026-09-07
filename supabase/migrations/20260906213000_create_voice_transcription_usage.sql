-- Fase 9B — controle de custo e idempotência da transcrição por voz.
--
-- Esta migration cria UMA única tabela da fase de voz. Ela não armazena
-- áudio, transcript, texto do usuário nem conteúdo de agenda. Guarda só
-- metadados mínimos necessários para: teto mensal rígido no próprio app,
-- idempotência, rate limit e acompanhamento de minutos/custo estimado.

create table public.voice_transcription_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  provider text not null,
  model text not null,
  status text not null default 'reserved',
  duration_ms integer not null default 0,
  estimated_cost_microusd bigint not null default 0,
  reserved_cost_microusd bigint not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,

  constraint voice_transcription_usage_request_unique
    unique (user_id, request_id),
  constraint voice_transcription_usage_provider_length
    check (char_length(provider) between 1 and 32),
  constraint voice_transcription_usage_model_length
    check (char_length(model) between 1 and 96),
  constraint voice_transcription_usage_status_check
    check (status in ('reserved', 'completed', 'failed')),
  constraint voice_transcription_usage_duration_check
    check (duration_ms between 0 and 20000),
  constraint voice_transcription_usage_estimated_cost_check
    check (estimated_cost_microusd between 0 and 1000000),
  constraint voice_transcription_usage_reserved_cost_check
    check (reserved_cost_microusd between 1 and 1000000)
);

comment on table public.voice_transcription_usage is
  'Metadados mínimos de consumo da Fase 9B. Nunca armazena áudio, transcript ou conteúdo de agenda. O teto interno mensal global do Mente Livre é aplicado atomicamente antes de qualquer chamada ao provedor.';

alter table public.voice_transcription_usage enable row level security;

-- O usuário pode ler apenas o próprio consumo. Escrita direta é proibida;
-- toda reserva/finalização passa por wrappers públicos estreitos que chamam
-- funções privilegiadas no schema private (mesmo padrão já adotado no
-- Google Calendar deste repositório).
revoke all on public.voice_transcription_usage from anon, authenticated;
grant select on public.voice_transcription_usage to authenticated;

create policy voice_transcription_usage_select_own
  on public.voice_transcription_usage
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy voice_transcription_usage_insert_never_direct
  on public.voice_transcription_usage
  for insert
  to authenticated
  with check (false);

create policy voice_transcription_usage_update_never_direct
  on public.voice_transcription_usage
  for update
  to authenticated
  using (false)
  with check (false);

create policy voice_transcription_usage_delete_never_direct
  on public.voice_transcription_usage
  for delete
  to authenticated
  using (false);

-- O schema `private` já é usado por migrations anteriores e não é exposto
-- em api.schemas. As instruções são repetidas de forma idempotente para que
-- esta migration preserve a propriedade de segurança por si mesma.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Limite interno rígido GLOBAL do Mente Livre para o MVP: US$ 4,00 por mês
-- calendário UTC, compartilhado por todos os usuários do app. Não é US$ 4
-- por usuário. O projeto OpenAI dedicado deve ter um hard spend limit
-- externo de US$ 5,00/mês antes da feature ser ativada em produção. O delta
-- de US$ 1,00 é margem adicional porque a aplicação para antes do provedor.
-- Aumentar qualquer um desses limites exige autorização explícita do dono.
--
-- A reserva também é FIXA no banco para o único modelo autorizado no MVP:
-- OpenAI gpt-transcribe, máximo 20s, US$ 0,0045/min => US$ 0,0015 por
-- chamada máxima = 1500 microUSD. O cliente/RPC público NÃO pode escolher
-- provider, modelo nem preço; isso evita que uma chamada direta ao RPC
-- envenene o orçamento com valores arbitrários.

create or replace function private.reserve_voice_transcription_usage(
  p_request_id uuid
)
returns table (status text, usage_id uuid, month_reserved_cost_microusd bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  v_existing_id uuid;
  v_month_reserved bigint;
  v_new_id uuid;
  v_recent_count integer;
  v_provider constant text := 'openai';
  v_model constant text := 'gpt-transcribe';
  v_reserved_cost constant bigint := 1500; -- 20s máximos a US$ 0,0045/min
  v_internal_monthly_cap constant bigint := 4000000; -- US$ 4.00 em microUSD
begin
  if v_user_id is null then
    return query select 'unauthenticated'::text, null::uuid, 0::bigint;
    return;
  end if;

  if p_request_id is null then
    return query select 'invalid'::text, null::uuid, 0::bigint;
    return;
  end if;

  -- Lock GLOBAL por mês, não por usuário. Sem isso, dois usuários poderiam
  -- passar simultaneamente pelo cheque e ultrapassar o teto total do app.
  perform pg_advisory_xact_lock(
    hashtextextended('mente-livre-voice:' || v_month_start::text, 0)
  );

  -- Idempotência continua por usuário + request_id: reenvio da mesma
  -- gravação nunca abre uma segunda reserva nem chama paga novamente.
  select v.id
    into v_existing_id
    from public.voice_transcription_usage v
   where v.user_id = v_user_id
     and v.request_id = p_request_id;

  if found then
    select coalesce(sum(v.reserved_cost_microusd), 0)
      into v_month_reserved
      from public.voice_transcription_usage v
     where v.created_at >= v_month_start
       and v.created_at < v_month_start + interval '1 month';

    return query select 'duplicate'::text, v_existing_id, v_month_reserved;
    return;
  end if;

  -- Rate limit por usuário, separado do teto global. Um comando de voz de
  -- até 20s torna seis novas reservas/minuto mais do que suficiente para o
  -- uso humano do MVP e limita spam/repetição acidental.
  select count(*)::integer
    into v_recent_count
    from public.voice_transcription_usage v
   where v.user_id = v_user_id
     and v.created_at > now() - interval '1 minute';

  if v_recent_count >= 6 then
    return query select 'rate_limited'::text, null::uuid, 0::bigint;
    return;
  end if;

  -- Soma GLOBAL: todas as reservas do Mente Livre no mês, qualquer usuário.
  select coalesce(sum(v.reserved_cost_microusd), 0)
    into v_month_reserved
    from public.voice_transcription_usage v
   where v.created_at >= v_month_start
     and v.created_at < v_month_start + interval '1 month';

  if v_month_reserved + v_reserved_cost > v_internal_monthly_cap then
    return query select 'budget_exceeded'::text, null::uuid, v_month_reserved;
    return;
  end if;

  insert into public.voice_transcription_usage (
    user_id,
    request_id,
    provider,
    model,
    status,
    reserved_cost_microusd
  ) values (
    v_user_id,
    p_request_id,
    v_provider,
    v_model,
    'reserved',
    v_reserved_cost
  )
  returning id into v_new_id;

  return query
    select 'reserved'::text, v_new_id, v_month_reserved + v_reserved_cost;
end;
$$;

revoke all on function private.reserve_voice_transcription_usage(uuid) from public;
grant execute on function private.reserve_voice_transcription_usage(uuid) to authenticated;

create or replace function public.reserve_voice_transcription_usage(
  p_request_id uuid
)
returns table (status text, usage_id uuid, month_reserved_cost_microusd bigint)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
    select *
      from private.reserve_voice_transcription_usage(p_request_id);
end;
$$;

revoke all on function public.reserve_voice_transcription_usage(uuid) from public, anon;
grant execute on function public.reserve_voice_transcription_usage(uuid) to authenticated;

create or replace function private.finalize_voice_transcription_usage(
  p_request_id uuid,
  p_status text,
  p_duration_ms integer,
  p_estimated_cost_microusd bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer;
begin
  if v_user_id is null then
    return false;
  end if;

  if p_request_id is null
     or p_status not in ('completed', 'failed')
     or p_duration_ms is null or p_duration_ms not between 0 and 20000
     or p_estimated_cost_microusd is null
     or p_estimated_cost_microusd not between 0 and 1500 then
    return false;
  end if;

  update public.voice_transcription_usage v
     set status = p_status,
         duration_ms = p_duration_ms,
         estimated_cost_microusd = p_estimated_cost_microusd,
         completed_at = now()
   where v.user_id = v_user_id
     and v.request_id = p_request_id
     and v.status = 'reserved'
     and p_estimated_cost_microusd <= v.reserved_cost_microusd;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function private.finalize_voice_transcription_usage(uuid, text, integer, bigint) from public;
grant execute on function private.finalize_voice_transcription_usage(uuid, text, integer, bigint) to authenticated;

create or replace function public.finalize_voice_transcription_usage(
  p_request_id uuid,
  p_status text,
  p_duration_ms integer,
  p_estimated_cost_microusd bigint
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.finalize_voice_transcription_usage(
    p_request_id,
    p_status,
    p_duration_ms,
    p_estimated_cost_microusd
  );
end;
$$;

revoke all on function public.finalize_voice_transcription_usage(uuid, text, integer, bigint) from public, anon;
grant execute on function public.finalize_voice_transcription_usage(uuid, text, integer, bigint) to authenticated;
