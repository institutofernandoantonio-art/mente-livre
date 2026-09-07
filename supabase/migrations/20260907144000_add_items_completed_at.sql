-- Fase 8 — Resumo do dia
--
-- Adiciona um instante explícito de conclusão às tarefas. `updated_at` não
-- é suficiente como fonte histórica porque pode mudar em futuras mutações.
-- Esta migration é aditiva: não remove dados, não altera RLS/policies/grants
-- e não muda os estados permitidos.

alter table public.items
  add column completed_at timestamptz;

-- Preserva o histórico já existente com a melhor informação disponível:
-- para tarefas que já estavam concluídas antes desta coluna existir,
-- `updated_at` corresponde ao último instante conhecido da transição.
update public.items
set completed_at = updated_at
where status = 'completed'
  and completed_at is null;

comment on column public.items.completed_at is
  'Instante em que a tarefa passou de pending para completed. Usado pelo resumo do dia; NULL para tarefas ainda não concluídas ou canceladas.';
