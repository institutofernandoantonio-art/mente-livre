create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brain_dump_id uuid not null references public.brain_dumps(id) on delete cascade,
  category text not null,
  title text not null,
  description text,
  priority text,
  needs_confirmation boolean not null default true,
  created_at timestamptz not null default now(),

  constraint items_brain_dump_id_unique
    unique (brain_dump_id),

  constraint items_category_allowed
    check (category in ('tarefa', 'compromisso', 'ideia', 'lembrete', 'outro')),

  constraint items_title_not_blank
    check (btrim(title) <> ''),

  constraint items_priority_allowed
    check (priority in ('alta', 'média', 'baixa'))
);

comment on table public.items is
  'Sugestão estruturada que a IA gera a partir de um brain_dump (Fase 4).
   needs_confirmation começa sempre true — a IA só recomenda, nada é
   executado automaticamente. Um brain_dump gera no máximo um item nesta
   fase (unique em brain_dump_id).';

alter table public.items enable row level security;

revoke all on public.items from anon;

grant select, insert, update, delete
on public.items
to authenticated;

create policy items_select_own
  on public.items
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy items_insert_own
  on public.items
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy items_update_own
  on public.items
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy items_delete_own
  on public.items
  for delete
  to authenticated
  using (auth.uid() = user_id);
