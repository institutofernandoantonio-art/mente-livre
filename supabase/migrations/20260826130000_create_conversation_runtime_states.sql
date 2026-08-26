-- Storage server-side efêmero para ConversationState/ProposalState
-- (src/lib/conversation/state.ts, src/lib/conversation/proposal-state.ts).
-- Uma única row ativa por usuário: mesma conta no celular e no computador
-- compartilha a mesma row via auth.uid() = user_id, sem device_id/session_id.
--
-- Nenhum domain type foi alterado por esta migration — identidade
-- (state_id) e discriminação (state_kind) pertencem só ao wrapper de
-- storage, nunca aos tipos puros ConversationState/ProposalState.

create table public.conversation_runtime_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_id uuid not null,
  state_kind text not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),

  constraint conversation_runtime_states_state_kind_allowed
    check (state_kind in ('clarification', 'proposal')),

  constraint conversation_runtime_states_payload_is_object
    check (jsonb_typeof(payload) = 'object')
);

comment on table public.conversation_runtime_states is
  'Runtime state conversacional efêmero (clarificação pendente ou proposta
   aguardando confirmação) — nunca um audit log. No máximo 1 row por
   usuário (user_id é a própria PK). payload ainda não é validado pelo
   banco além de ser um objeto JSON; nenhum consumer deve tratá-lo como
   type-safe sem validação runtime numa camada futura. Existência desta
   row nunca representa autorização para executar nenhuma ação.';

alter table public.conversation_runtime_states enable row level security;

revoke all on public.conversation_runtime_states from anon;

grant select, insert, update, delete
on public.conversation_runtime_states
to authenticated;

create policy conversation_runtime_states_select_own
  on public.conversation_runtime_states
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy conversation_runtime_states_insert_own
  on public.conversation_runtime_states
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy conversation_runtime_states_update_own
  on public.conversation_runtime_states
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy conversation_runtime_states_delete_own
  on public.conversation_runtime_states
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Reaproveita a função já criada em 0001_create_profiles.sql (e já
-- reaproveitada em 20260826120000_evolve_items_for_tasks.sql) — nenhuma
-- função nova. Só observabilidade/debug: nunca usada como CAS (CAS usa
-- state_id, comparado pela futura camada de repository).
create trigger set_conversation_runtime_states_updated_at
  before update on public.conversation_runtime_states
  for each row
  execute function public.set_updated_at();
