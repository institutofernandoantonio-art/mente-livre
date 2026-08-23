create table public.brain_dumps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  raw_text text not null,
  source text not null default 'text',
  created_at timestamptz not null default now(),

  constraint brain_dumps_raw_text_not_blank
    check (btrim(raw_text) <> ''),

  constraint brain_dumps_raw_text_max_length
    check (char_length(raw_text) <= 10000),

  constraint brain_dumps_source_allowed
    check (source in ('text'))
);

comment on table public.brain_dumps is
  'Pensamentos capturados pelo usuário em texto livre (Fase 3).';

alter table public.brain_dumps enable row level security;

revoke all on public.brain_dumps from anon;

grant select, insert, update, delete
on public.brain_dumps
to authenticated;

create policy brain_dumps_select_own
  on public.brain_dumps
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy brain_dumps_insert_own
  on public.brain_dumps
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy brain_dumps_update_own
  on public.brain_dumps
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy brain_dumps_delete_own
  on public.brain_dumps
  for delete
  to authenticated
  using (auth.uid() = user_id);
