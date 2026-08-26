-- Evolui `items` de "resultado de organização de brain dump" para uma
-- entidade operacional de tarefa, capaz de nascer também diretamente do
-- futuro pipeline conversacional (StructuredIntent create_task), sem
-- brain dump de origem.
--
-- Mudança estritamente aditiva/relaxante: nenhuma linha existente deixa
-- de ser válida, nenhum dado é alterado ou removido, nenhuma policy/grant
-- é tocada. Ver relatório de mapeamento da subfase correspondente.

-- 1. brain_dump_id passa a ser opcional --------------------------------------
-- FK, ON DELETE CASCADE e UNIQUE(brain_dump_id) permanecem exatamente como
-- estão — Postgres já permite múltiplos NULL numa UNIQUE, então isso já
-- basta para múltiplas tasks conversacionais sem brain dump. Suporte a "1
-- brain dump → múltiplos items" fica deliberadamente fora desta migration.

alter table public.items
  alter column brain_dump_id drop not null;

-- 2. category ganha default, continua NOT NULL com o check atual -----------
-- 'tarefa' é derivação operacional legítima para uma task nascida
-- diretamente de create_task (que já é semanticamente uma tarefa) — nunca
-- nullable, para não introduzir `category: null` em runtime onde hoje
-- ReferenceCandidate.category espera string | undefined
-- (src/lib/conversation/reference-resolution.ts).

alter table public.items
  alter column category set default 'tarefa';

-- 3. deadline_at --------------------------------------------------------
-- Instante ISO já resolvido (StructuredIntent.create_task.deadline.value.at
-- quando source é 'stated'/'inferred') — nunca uma expressão temporal
-- ambígua ou day-only. NULL cobre tanto ausência de deadline quanto
-- deadline ainda 'unresolved'.

alter table public.items
  add column deadline_at timestamptz;

-- 4. duration_minutes -----------------------------------------------------
-- Estimativa de esforço (StructuredIntent.create_task.duration.value.minutes
-- quando resolvido). O check aqui é só sanidade estrutural — a faixa de
-- produto (5–720) continua aplicada em
-- src/lib/conversation/answer-resolution.ts, não duplicada no banco.

alter table public.items
  add column duration_minutes integer;

alter table public.items
  add constraint items_duration_minutes_positive
    check (duration_minutes is null or duration_minutes > 0);

-- 5. status ---------------------------------------------------------------
-- Estado operacional mínimo. Cancelar uma tarefa usa status='cancelled',
-- nunca DELETE — preserva histórico. Sem estados adicionais
-- (in_progress/planned/archived) por falta de necessidade real hoje.

alter table public.items
  add column status text not null default 'pending';

alter table public.items
  add constraint items_status_allowed
    check (status in ('pending', 'completed', 'cancelled'));

-- 6. updated_at + trigger ---------------------------------------------------
-- Reaproveita public.set_updated_at(), já criada e usada por
-- public.profiles (0001_create_profiles.sql) — nenhuma função nova.

alter table public.items
  add column updated_at timestamptz not null default now();

create trigger set_items_updated_at
  before update on public.items
  for each row
  execute function public.set_updated_at();

-- 7. Documentação atualizada ------------------------------------------------

comment on table public.items is
  'Tarefa/sugestão operacional. Pode nascer da organização automática de um
   brain_dump (Fase 4, brain_dump_id preenchido) ou diretamente do futuro
   pipeline conversacional StructuredIntent create_task (brain_dump_id
   NULL). needs_confirmation permanece legado da Fase 4, não usado pela
   futura Confirmation Policy.';
