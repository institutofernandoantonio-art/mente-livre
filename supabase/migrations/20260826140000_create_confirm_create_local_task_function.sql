-- Suporte a Execution atômica de `create_local_task` — corrige a lacuna
-- identificada no mapeamento de Execution/idempotência: `consumeRuntimeState`
-- seguido de um INSERT separado (duas transações independentes) permite que
-- uma confirmação já aceita (claim vencido) simplesmente desapareça se o
-- processo cair entre as duas operações. Esta migration resolve isso com
-- UMA função transacional que faz claim + criação da tarefa + consumo da
-- runtime row atomicamente: ou os três acontecem juntos, ou nenhum acontece.
--
-- Mudança estritamente aditiva: nenhuma linha existente é alterada, nenhuma
-- policy/grant de tabela já existente é tocada, nenhuma migration anterior é
-- modificada. Ver relatório de mapeamento da subfase correspondente.

-- 1. items.proposal_id -------------------------------------------------------
-- Identidade lógica da proposta que originou este item — nunca PK de uma
-- tabela durável, então NENHUMA foreign key é criada (proposalId é gerado
-- e vive só dentro do payload JSONB de conversation_runtime_states, uma
-- linha efêmera; uma FK para ela não faria sentido nem seria estável).
-- Serve só como correlation key / idempotency key / defesa em profundidade.
-- Nullable: itens históricos e itens vindos de brain_dump (Fase 4) nunca
-- preenchem esta coluna — Postgres já permite múltiplos NULL numa UNIQUE,
-- mesma técnica já usada por items_brain_dump_id_unique.

alter table public.items
  add column proposal_id uuid;

alter table public.items
  add constraint items_proposal_id_unique
    unique (proposal_id);

-- 2. Função transacional de confirmação + criação -----------------------
--
-- SECURITY INVOKER (não DEFINER): a função só precisa fazer exatamente o
-- que o próprio usuário autenticado já pode fazer nas suas próprias linhas
-- — SELECT/DELETE em conversation_runtime_states e INSERT em items, ambos
-- já concedidos via RLS+grants existentes (ver policies *_own de cada
-- tabela). Nenhuma operação aqui exige privilégio além do que auth.uid()
-- já tem sobre seus próprios dados — usar DEFINER seria escalação de
-- privilégio desnecessária. Diferente de public.handle_new_user() (que
-- precisa de DEFINER por rodar em contexto de trigger em auth.users, antes
-- de existir qualquer sessão/RLS aplicável ao próprio usuário) — não é o
-- caso aqui.
--
-- search_path fixado em '' (mesma disciplina já usada em
-- public.handle_new_user()) e toda referência a objeto é schema-qualified
-- (`public.items`, `public.conversation_runtime_states`, `auth.uid()`) —
-- necessário mesmo sob SECURITY INVOKER, para nunca depender de resolução
-- implícita de nomes.
--
-- Entrada: SOMENTE dados já derivados/validados server-side pelo futuro
-- wrapper TypeScript, a partir de uma ProposalState já lida e validada por
-- runtime-state-validation.ts — nunca userId (deriva de auth.uid()), nunca
-- o payload JSON bruto da proposta, nunca dado arbitrário vindo do browser.
-- `p_proposal_id` é comparado contra `payload->>'proposalId'` como defesa
-- em profundidade adicional (um acesso de chave plana e estável dentro de
-- um JSON cujo shape na raiz nunca muda — não é um segundo validator, só
-- uma checagem de consistência do próprio chamador) — a garantia real de
-- que a action ainda corresponde à proposta atual já vem do CAS por
-- state_id (ver TOCTOU no relatório de mapeamento: state_id nunca é
-- reaproveitado por runtime-state-storage.ts, então se o CAS encontra o
-- state_id esperado, nenhuma escrita ocorreu desde a leitura original).
--
-- CAS: `SELECT ... FOR UPDATE` sobre a única linha do usuário
-- (user_id = auth.uid(), PK da tabela) trava essa linha para a duração da
-- transação — qualquer DELETE concorrente (cancelamento, via
-- consumeRuntimeState) ou outra chamada concorrente desta mesma função
-- sobre a mesma linha bloqueia nativamente até esta transação
-- commitar/abortar (MVCC do Postgres), sem mutex de aplicação, sem
-- advisory lock, sem campo booleano auxiliar. Exige explicitamente
-- state_kind = 'proposal' e expires_at > p_now — mesma semântica de
-- validade já usada por advanceRuntimeState/consumeRuntimeState
-- (src/lib/conversation/runtime-state-storage.ts).
--
-- Se o claim falhar por QUALQUER motivo (state_id obsoleto, já consumida,
-- expirada, ou proposal_id divergente) — `NOT FOUND` — retorna `conflict`
-- sem nunca tentar o INSERT. Nenhuma segunda query tenta "explicar" a
-- causa (mesmo risco de TOCTOU/corrida já evitado em toda a pilha
-- existente). Nenhuma proposta expirada é apagada automaticamente aqui —
-- só deixa de ser elegível para este claim.
--
-- Ordem interna: CAS/lock primeiro, INSERT depois, DELETE da runtime row
-- por último — se qualquer passo falhar, ROLLBACK desfaz tudo
-- automaticamente (nenhuma exception é capturada genericamente: um erro
-- técnico real, incluindo uma violação de UNIQUE(proposal_id) — que no
-- fluxo normal já é impossível, porque o CAS acima já teria barrado uma
-- segunda tentativa concorrente antes do INSERT — propaga como erro real
-- da função, nunca é silenciosamente convertido em `created` nem em
-- `conflict`; o futuro wrapper TypeScript sanitiza isso externamente).
--
-- needs_confirmation é explicitamente `false` (nunca o DEFAULT `true` da
-- coluna) — a tarefa só chega a este ponto depois de confirmação explícita
-- via Confirmation Policy. brain_dump_id é explicitamente `null` — esta
-- tarefa nasce do pipeline conversacional, nunca de um brain dump.
-- category/status/created_at/updated_at usam os DEFAULTs já existentes da
-- tabela ('tarefa'/'pending'/now()/now()) — não redeclarados aqui.
-- priority nunca é inserido — ProposedAction não tem esse conceito.
--
-- Retorno: união mínima `created`/`conflict`, sem status adicional (nem
-- `expired`/`not_found`/`invalid_action` — todos colapsam em `conflict`,
-- mesma disciplina já usada por advanceRuntimeState/consumeRuntimeState).
-- Em sucesso, devolve também o `item_id` criado — simples e diretamente
-- tipável pelo wrapper, sem aumentar a superfície de erro.
--
-- Zero menção/operação de Google Calendar — esta função é exclusivamente
-- para create_local_task.

create or replace function public.confirm_create_local_task(
  p_expected_state_id uuid,
  p_now timestamptz,
  p_proposal_id uuid,
  p_title text,
  p_description text,
  p_deadline_at timestamptz,
  p_duration_minutes integer
)
returns table (status text, item_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_item_id uuid;
begin
  select payload
    into v_payload
    from public.conversation_runtime_states
   where user_id = auth.uid()
     and state_id = p_expected_state_id
     and state_kind = 'proposal'
     and expires_at > p_now
     and (payload ->> 'proposalId') = p_proposal_id::text
   for update;

  if not found then
    return query select 'conflict'::text, null::uuid;
    return;
  end if;

  insert into public.items (
    user_id,
    proposal_id,
    title,
    description,
    deadline_at,
    duration_minutes,
    brain_dump_id,
    needs_confirmation
  ) values (
    auth.uid(),
    p_proposal_id,
    p_title,
    p_description,
    p_deadline_at,
    p_duration_minutes,
    null,
    false
  )
  returning id into v_item_id;

  delete from public.conversation_runtime_states
   where user_id = auth.uid()
     and state_id = p_expected_state_id;

  return query select 'created'::text, v_item_id;
end;
$$;

-- 3. Grants ---------------------------------------------------------------
-- Postgres concede EXECUTE a PUBLIC por padrão na criação de uma função
-- (diferente de tabelas, que não concedem nada por padrão) — por isso o
-- REVOKE explícito abaixo é necessário para fechar essa porta antes de
-- reabri-la só para `authenticated`. `anon` nunca recebe EXECUTE (nem
-- explicitamente, nem via PUBLIC, já revogado). Nenhum grant a
-- service_role — a função nunca precisa dele.

revoke all on function public.confirm_create_local_task(
  uuid, timestamptz, uuid, text, text, timestamptz, integer
) from public;

grant execute on function public.confirm_create_local_task(
  uuid, timestamptz, uuid, text, text, timestamptz, integer
) to authenticated;
