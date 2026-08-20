-- Mente Livre — Fase 2
-- Cria a tabela `profiles`, isolamento por RLS (política explícita por
-- operação) e o mecanismo automático de criação de perfil no cadastro.
-- Não cria nenhuma outra tabela (brain_dumps/items/daily_plans ficam para
-- as fases em que forem efetivamente usadas).

begin;

-- 1. Tabela ---------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Perfil público do usuário. id é o mesmo id de auth.users — 1 perfil por conta.';

-- 2. RLS: habilitada explicitamente ----------------------------------------
-- Mesmo com "RLS automático" ligado nas configurações do projeto, o comando
-- abaixo garante que a proteção existe de fato nesta tabela, sem depender
-- de nenhum comportamento implícito do painel.
-- (Avaliado e descartado `force row level security`: só teria efeito sobre
-- o dono da tabela/papéis com BYPASSRLS, que em nosso modelo de ameaça atual
-- nunca são usados pelo app — `anon`/`authenticated` já ficam presos pelo
-- `enable` sozinho. Ver explicação completa na conversa da Fase 2.)

alter table public.profiles enable row level security;

-- 3. Privilégios mínimos ----------------------------------------------------
-- `anon` (visitante não logado) não tem nenhum acesso à tabela.
-- `authenticated` (usuário logado) tem acesso de tabela, mas cada política
-- abaixo ainda restringe linha por linha — as duas camadas trabalham juntas.

revoke all on public.profiles from anon;
grant select, insert, update, delete on public.profiles to authenticated;

-- 4. Políticas — uma por operação, nunca "for all" -------------------------

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own
  on public.profiles
  for delete
  to authenticated
  using (auth.uid() = id);

-- 5. Manter updated_at correto automaticamente ------------------------------
-- Sem isso, a coluna updated_at nunca mudaria depois da criação da linha.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- 6. Criação automática de perfil no cadastro -------------------------------
-- Dispara depois que o Supabase Auth insere um novo usuário em auth.users.
-- `security definer` = a função roda com o privilégio de quem a criou (não
-- do usuário que acabou de se cadastrar), porque nesse momento o usuário
-- ainda não tem uma sessão para passar pela política de INSERT normal.
-- `search_path` fixado em '' (vazio) é a versão mais restritiva da proteção
-- padrão contra sequestro de search_path em funções security definer: com
-- ele vazio, a função não resolve NENHUM nome de objeto automaticamente —
-- por isso toda referência abaixo é qualificada por completo (`public.profiles`).
-- `on conflict (id) do nothing` torna a função segura para rodar mais de
-- uma vez sem gerar erro nem duplicar linha (idempotente).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, null)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

commit;
